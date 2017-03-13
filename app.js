const restify = require('restify');
const bunyan = require('bunyan');
const mongoose = require('mongoose');
const passport = require('passport');
const BearerStrategy = require('passport-azure-ad').BearerStrategy;

const config = require('./config');
const util = require("util");


const options = {
    // The URL of the metadata document for your app. We will put the keys for token validation from the URL found in the jwks_uri tag of the in the metadata.
    identityMetadata: config.creds.identityMetadata,
    clientID: config.creds.clientID,
    validateIssuer: config.creds.validateIssuer,
    audience: config.creds.audience,
    passReqToCallback: config.creds.passReqToCallback,
    loggingLevel: config.creds.loggingLevel

};

// Array to hold logged in users and the current logged in user (owner).
let users = [];
let owner = null;

// Our logger.
const log = bunyan.createLogger({
    name: 'Azure Active Directory Bearer Sample',
    streams: [
        {
            stream: process.stderr,
            level: "error",
            name: "error"
        },
        {
            stream: process.stdout,
            level: "warn",
            name: "console"
        }, ]
});

// If the logging level is specified, switch to it.
if (config.creds.loggingLevel) { log.levels("console", config.creds.loggingLevel); }

// MongoDB setup.
// Set up some configuration.
const serverPort = process.env.PORT || 8080;
const serverURI = (process.env.PORT) ? config.creds.mongoose_auth_mongohq : config.creds.mongoose_auth_local;

// Connect to MongoDB.
global.db = mongoose.connect(serverURI);
const Schema = mongoose.Schema;
log.info('MongoDB Schema loaded');

// Here we create a schema to store our tasks and users. It's a fairly simple schema for now.
const TaskSchema = new Schema({
    owner: String,
    task: String,
    completed: Boolean,
    date: Date
});

// Use the schema to register a model.
mongoose.model('Task', TaskSchema);
const Task = mongoose.model('Task');




/**
 *
 * APIs for our REST Task server.
 */

// Create a task.

function createTask(req, res, next) {

    // Restify currently has a bug which doesn't allow you to set default headers.
    // These headers comply with CORS and allow us to mongodbServer our response to any origin.

    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");

    // Create a new task model, fill it, and save it to Mongodb.
    let _task = new Task();

    if (!req.params.task) {
        req.log.warn('createTodo: missing task');
        next(new MissingTaskError());
        return;
    }

    _task.owner = owner;
    _task.task = req.params.task;
    _task.date = new Date();

    _task.save(function(err) {
        if (err) {
            req.log.warn(err, 'createTask: unable to save');
            next(err);
        } else {
            res.send(201, _task);

        }
    });

    return next();

}


// Delete a task by name.

function removeTask(req, res, next) {

    Task.remove({
        task: req.params.task,
        owner: owner
    }, function(err) {
        if (err) {
            req.log.warn(err,
                'removeTask: unable to delete %s',
                req.params.task);
            next(err);
        } else {
            log.info('Deleted task:', req.params.task);
            res.send(204);
            next();
        }
    });
}

// Delete all tasks.

function removeAll(req, res, next) {
    Task.remove();
    res.send(204);
    return next();
}


// Get a specific task based on name.

function getTask(req, res, next) {

    log.info('getTask was called for: ', owner);
    Task.find({
        owner: owner
    }, function(err, data) {
        if (err) {
            req.log.warn(err, 'get: unable to read %s', owner);
            next(err);
            return;
        }

        res.json(data);
    });

    return next();
}

/// Simple returns the list of TODOs that were loaded.

function listTasks(req, res, next) {
    // Restify currently has a bug which doesn't allow you to set default headers.
    // These headers comply with CORS and allow us to mongodbServer our response to any origin.

    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");

    log.info("listTasks was called for: ", owner);

    Task.find({
        owner: owner
    }).limit(20).sort('date').exec(function(err, data) {

        if (err) {
            return next(err);
        }

        if (data.length > 0) {
            log.info(data);
        }

        if (!data.length) {
            log.warn(err, "There is no tasks in the database. Did you initialize the database as stated in the README?");
        }

        if (!owner) {
            log.warn(err, "You did not pass an owner when listing tasks.");
        } else {

            res.json(data);

        }
    });

    return next();
}


///--- Errors for communicating something interesting back to the client.

function MissingTaskError() {
    restify.RestError.call(this, {
        statusCode: 409,
        restCode: 'MissingTask',
        message: '"task" is a required parameter',
        constructorOpt: MissingTaskError
    });

    this.name = 'MissingTaskError';
}
util.inherits(MissingTaskError, restify.RestError);


function TaskExistsError(owner) {
    assert.string(owner, 'owner');

    restify.RestError.call(this, {
        statusCode: 409,
        restCode: 'TaskExists',
        message: owner + ' already exists',
        constructorOpt: TaskExistsError
    });

    this.name = 'TaskExistsError';
}
util.inherits(TaskExistsError, restify.RestError);


function TaskNotFoundError(owner) {
    assert.string(owner, 'owner');

    restify.RestError.call(this, {
        statusCode: 404,
        restCode: 'TaskNotFound',
        message: owner + ' was not found',
        constructorOpt: TaskNotFoundError
    });

    this.name = 'TaskNotFoundError';
}

util.inherits(TaskNotFoundError, restify.RestError);



/**
 * Our server.
 */


const server = restify.createServer({
    name: "Azure Active Directroy TODO Server",
    version: "2.0.1"
});

// Ensure we don't drop data on uploads.
server.pre(restify.pre.pause());

// Clean up sloppy paths like //todo//////1//.
server.pre(restify.pre.sanitizePath());

// Handle annoying user agents (curl).
server.pre(restify.pre.userAgentConnection());

// Set a per request bunyan logger (with requestid filled in).
server.use(restify.requestLogger());

// Allow five requests per second by IP, and burst to 10.
server.use(restify.throttle({
    burst: 10,
    rate: 5,
    ip: true,
}));

// Use the common stuff you probably want.
server.use(restify.acceptParser(server.acceptable));
server.use(restify.dateParser());
server.use(restify.queryParser());
server.use(restify.gzipResponse());
server.use(restify.bodyParser({
    mapParams: true
})); // Allow for JSON mapping to REST.

/// Now the real handlers. Here we just CRUD.
/**
 /*
 /* Each of these handlers is protected by our OIDCBearerStrategy by invoking 'oidc-bearer'.
 /* In the pasport.authenticate() method. We set 'session: false' because REST is stateless and
 /* we don't need to maintain session state. You can experiment with removing API protection
 /* by removing the passport.authenticate() method as follows:
 /*
 /* server.get('/tasks', listTasks);
 /*
 **/

server.get('/tasks', passport.authenticate('oauth-bearer', {
    session: false
}), listTasks);
server.get('/tasks', passport.authenticate('oauth-bearer', {
    session: false
}), listTasks);
server.get('/tasks/:owner', passport.authenticate('oauth-bearer', {
    session: false
}), getTask);
server.head('/tasks/:owner', passport.authenticate('oauth-bearer', {
    session: false
}), getTask);
server.post('/tasks/:owner/:task', passport.authenticate('oauth-bearer', {
    session: false
}), createTask);
server.post('/tasks', passport.authenticate('oauth-bearer', {
    session: false
}), createTask);
server.del('/tasks/:owner/:task', passport.authenticate('oauth-bearer', {
    session: false
}), removeTask);
server.del('/tasks/:owner', passport.authenticate('oauth-bearer', {
    session: false
}), removeTask);
server.del('/tasks', passport.authenticate('oauth-bearer', {
    session: false
}), removeTask);
server.del('/tasks', passport.authenticate('oauth-bearer', {
    session: false
}), removeAll, function respond(req, res, next) {
    res.send(204);
    next();
});

// Register a default '/' handler.
server.get('/', function root(req, res, next) {
    let routes = [
        'GET /',
        'POST /tasks/:owner/:task',
        'POST /tasks (for JSON body)',
        'GET /tasks',
        'PUT /tasks/:owner',
        'GET /tasks/:owner',
        'DELETE /tasks/:owner/:task'
    ];
    res.send(200, routes);
    next();
});





// Let's start using Passport.js.

server.use(passport.initialize()); // Starts passport.
server.use(passport.session()); // Provides session support.

/**
 /*
 /* Calling the OIDCBearerStrategy and managing users.
 /*
 /* Passport pattern provides the need to manage users and info tokens
 /* with a FindorCreate() method that must be provided by the implementor.
 /* Here we just auto-register any user and implement a FindById().
 /* You'll want to do something smarter.
 **/

let findById = function(id, fn) {
    for (let i = 0, len = users.length; i < len; i++) {
        let user = users[i];
        if (user.sub === id) {
            log.info('Found user: ', user);
            return fn(null, user);
        }
    }
    return fn(null, null);
};


let bearerStrategy = new BearerStrategy(options,
    function(token, done) {
        log.info('verifying the user');
        log.info(token, 'was the token retreived');
        findById(token.sub, function(err, user) {
            if (err) {
                return done(err);
            }
            if (!user) {
                // "Auto-registration"
                log.info('User was added automatically as they were new. Their sub is: ', token.sub);
                users.push(token);
                owner = token.sub;
                return done(null, token);
            }
            owner = token.sub;
            return done(null, user, token);
        });
    }
);

passport.use(bearerStrategy);


server.listen(serverPort, function() {
    let consoleMessage = '\n Microsoft Azure Active Directory Tutorial';
    consoleMessage += '\n +++++++++++++++++++++++++++++++++++++++++++++++++++++';
    consoleMessage += '\n %s server is listening at %s';
    consoleMessage += '\n Open your browser to %s/tasks\n';
    consoleMessage += '+++++++++++++++++++++++++++++++++++++++++++++++++++++ \n';
    consoleMessage += '\n !!! why not try a $curl -isS %s | json to get some ideas? \n';
    consoleMessage += '+++++++++++++++++++++++++++++++++++++++++++++++++++++ \n\n';
});

