### smartcar-node demo
[Running our demo app](https://support.smartcar.com/getting-started/run-our-demo-app)

To run the demo:
```bash
git clone https://github.com/smartcar/getting-started.git
cd getting-started/node
npm install

# For security, you must configure http://localhost:8000/callback as a redirect uri in Smartcar's developer portal.
PORT=8000 \
SMARTCAR_CLIENT_ID="CLIENT_ID" \
SMARTCAR_SECRET="CLIENT_SECRET" \
SMARTCAR_REDIRECT_URI=http://localhost:8000/callback \
SMARTCAR_MODE=test \
node app.js
# Navigate to http://localhost:8000
```
