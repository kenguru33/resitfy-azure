module.exports.creds = {
    mongoose_auth_local: 'mongodb://dbuser:xx1487yy@ds157529.mlab.com:57529/mylabdb', // Your mongo auth uri goes here
    clientID: '065cd418-0fc7-4968-b48a-361e1e5ab640',
    audience: 'https://berntankernssr.onmicrosoft.com/253a5fac-a3ed-44da-a78f-ff357d6a2ce3',
    // you cannot have users from multiple tenants sign in to your server unless you use the common endpoint
    // example: https://login.microsoftonline.com/common/.well-known/openid-configuration
    identityMetadata: 'https://login.microsoftonline.com/f7cf664d-f03c-48ac-9688-35dcd90e3c22/.well-known/openid-configuration',
    validateIssuer: true, // if you have validation on, you cannot have users from multiple tenants sign in to your server
    passReqToCallback: false,
    loggingLevel: 'info' // valid are 'info', 'warn', 'error'. Error always goes to stderr in Unix.
};
