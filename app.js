'use strict';

console.clear();
const _ = require('lodash');
const Promise = require('bluebird');
const bodyParser = require('body-parser');
const envvar = require('envvar');
const exphbs = require('express-handlebars');
const express = require('express');
const session = require('cookie-session');
const smartcar = require('smartcar');
const opn = require('opn');
const url = require('url');
const validator = require('validator');
const axios = require('axios');

// Set Smartcar configuration
const PORT = process.env.PORT || 8000;
/*const SMARTCAR_CLIENT_ID = envvar.string('SMARTCAR_CLIENT_ID');
const SMARTCAR_SECRET = envvar.string('SMARTCAR_SECRET');

// Validate Client ID and Secret are UUIDs
if (!validator.isUUID(SMARTCAR_CLIENT_ID)) {
  throw new Error('CLIENT_ID is invalid. Please check to make sure you have replaced CLIENT_ID with the Client ID obtained from the Smartcar developer dashboard.');
}

if (!validator.isUUID(SMARTCAR_SECRET)) {
  throw new Error('SMARTCAR_SECRET is invalid. Please check to make sure you have replaced SMARTCAR_SECRET with your Client Secret obtained from the Smartcar developer dashboard.');
}*/

// Redirect uri must be added to the application's allowed redirect uris
// in the Smartcar developer portal
const SMARTCAR_REDIRECT_URI = envvar.string('SMARTCAR_REDIRECT_URI', `http://localhost:${PORT}/callback`);

// Setting MODE to "test" will run the Smartcar auth flow in test mode
const SMARTCAR_MODE = envvar.oneOf('SMARTCAR_MODE', ['test', 'live'], 'test');

// Initialize Smartcar client
const client = new smartcar.AuthClient({
  clientId: 'e90daa70-c88a-4610-a947-c300404b90bd',
  clientSecret: '99a61c53-d648-4c46-9d4b-c9c91f1fa261',
  redirectUri: 'http://localhost:8000/callback',
  testMode: SMARTCAR_MODE === 'test',
});

/**
 * Configure express server with handlebars as the view engine.
 */
const app = express();
app.use(session({
  name: 'demo-session',
  secret: 'super-duper-secret',
}));
app.use(express.static('public'));
app.use(bodyParser.urlencoded({
  extended: false
}));
app.engine('.hbs', exphbs({
  defaultLayout: 'main',
  extname: '.hbs',
}));
app.set('view engine', '.hbs');

/**
 * Render home page with a "Connect your car" button.
 */
app.get('/', function (req, res, next) {

  res.render('home', {
    authUrl: client.getAuthUrl(),
    testMode: SMARTCAR_MODE === 'test',
  });

});

/**
 * Helper function that redirects to the /error route with a specified
 * error message and action.
 */
const redirectToError = (res, message, action) => res.redirect(url.format({
  pathname: '/error',
  query: { message, action },
}));

/**
 * Render error page. Displays the action that was attempted and the error
 * message associated with that action (extracted from query params).
 */
app.get('/error', function (req, res, next) {

  const { action, message } = req.query;
  if (!action && !message) {
    return res.redirect('/');
  }

  res.render('error', { action, message });

});

/**
 * Disconnect each vehicle to cleanly logout.
 */
app.get('/logout', function (req, res, next) {
  const { access, vehicles } = req.session;
  return Promise.map(_.keys(vehicles), (id) => {
    const instance = new smartcar.Vehicle(id, access.accessToken);
    return instance.disconnect();
  })
    .finally(() => {
      req.session = null;
      res.redirect('/');
    });

});

/**
 * Called on return from the Smartcar authorization flow. This route extracts
 * the authorization code from the url and exchanges the code with Smartcar
 * for an access token that can be used to make requests to the vehicle.
 */
app.get('/callback', function (req, res, next) {
  const code = _.get(req, 'query.code');
  if (!code) {
    return res.redirect('/');
  }

  // Exchange authorization code for access token
  client.exchangeCode(code)
    .then(function (access) {
      req.session = {};
      req.session.vehicles = {};
      req.session.access = access;
      return res.redirect('/vehicles');
    })
    .catch(function (err) {
      const message = err.message || `Failed to exchange authorization code for access token`;
      const action = 'exchanging authorization code for access token';
      return redirectToError(res, message, action);
    });

});

/**
 * Renders a list of vehicles. Lets the user select a vehicle and type of
 * request, then sends a POST request to the /request route.
 */
app.get('/vehicles', function (req, res, next) {
  const { access, vehicles } = req.session;
  if (!access) {
    return res.redirect('/');
  }
  const { accessToken } = access;
  smartcar.getVehicleIds(accessToken)
    .then(function (data) {
      const vehicleIds = data.vehicles;
      const vehiclePromises = vehicleIds.map(vehicleId => {
        const vehicle = new smartcar.Vehicle(vehicleId, accessToken);
        req.session.vehicles[vehicleId] = {
          id: vehicleId,
        };
        return vehicle.info();
      });

      return Promise.all(vehiclePromises)
        .then(function (data) {
          // Add vehicle info to vehicle objects
          _.forEach(data, vehicle => {
            const { id: vehicleId } = vehicle;
            req.session.vehicles[vehicleId] = vehicle;
          });

          res.render('vehicles', { vehicles: req.session.vehicles });
        })
        .catch(function (err) {
          const message = err.message || 'Failed to get vehicle info.';
          const action = 'fetching vehicle info';
          return redirectToError(res, message, action);
        });
    });

});

/**
 * Triggers a request to the vehicle and renders the response.
 */
app.post('/request', function (req, res, next) {
  const { access, vehicles } = req.session;
  if (!access) {
    return res.redirect('/');
  }

  const { vehicleId, requestType: type } = req.body;
  const vehicle = vehicles[vehicleId];
  const instance = new smartcar.Vehicle(vehicleId, access.accessToken);
  let data = null;

  switch (type) {
    case 'info':
      instance.info()
        .then(data => res.render('data', { data, type, vehicle }))
        .catch(function (err) {
          const message = err.message || 'Failed to get vehicle info.';
          const action = 'fetching vehicle info';
          return redirectToError(res, message, action);
        });
      break;
    case 'location':
      instance.location()
        .then(({ data }) => res.render('data', { data, type, vehicle }))
        .catch(function (err) {
          const message = err.message || 'Failed to get vehicle location.';
          const action = 'fetching vehicle location';
          return redirectToError(res, message, action);
        });
      break;
    case 'odometer':
      instance.odometer()
        .then(({ data }) => res.render('data', { data, type, vehicle }))
        .catch(function (err) {
          const message = err.message || 'Failed to get vehicle odometer.';
          const action = 'fetching vehicle odometer';
          return redirectToError(res, message, action);
        });
      break;
    case 'lock':
      instance.lock()
        .then(function () {
          res.render('data', {
            // Lock and unlock requests do not return data if successful
            data: {
              action: 'Lock request sent.',
            },
            type,
            vehicle,
          });
        })
        .catch(function (err) {
          const message = err.message || 'Failed to send lock request to vehicle.';
          const action = 'locking vehicle';
          return redirectToError(res, message, action);
        });
      break;
    case 'report an accident':
      instance.location()
        .then(({ data }) => {
          return axios.post('https://postb.in/eZqJjSAL', {
            location: JSON.stringify(data),
          })
        })
        .then(function () {
          res.render('report', { data, type, vehicle });
        })
        .catch(function (err) {
          const message = err.message || 'Failed to get vehicle location.';
          const action = 'fetching vehicle location';
          return redirectToError(res, message, action);
        });
      break;
    case 'unlock':
      instance.unlock()
        .then(function () {
          res.render('data', {
            vehicle,
            type,
            // Lock and unlock requests do not return data if successful
            data: {
              action: 'Unlock request sent.',
            },
          });
        })
        .catch(function (err) {
          const message = err.message || 'Failed to send unlock request to vehicle.';
          const action = 'unlocking vehicle';
          return redirectToError(res, message, action);
        });
      break;
    default:
      return redirectToError(
        res,
        `Failed to find request type ${requestType}`,
        'sending request to vehicle'
      );
  }

});

app.listen(PORT, function () {
  console.log(`smartcar-demo server listening on port ${PORT}`);
  opn(`http://localhost:${PORT}`);
});
