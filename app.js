const express           = require('express');
const path              = require('path');
const logger            = require('morgan');
const StorageModule     = require('./logic/storage/storage_redis');    // the persistence module


// region CONFIG
// noinspection JSValidateJSDoc
/** @type {IORedis.RedisOptions | string | undefined} */
let redisConf           = undefined; // declaration
// if the REDIS CONF PATH variable is present that means that the user(DevOps) want's us to read the redis connection settings from some JSON file
if (process.env['REDIS_CONF_PATH']) {
	try {
		// we'll try to read and parse the config file
		redisConf       = JSON.parse(fs.readFileSync(process.env['REDIS_CONF_PATH']));
	} catch (configLoadingException) {
		console.error(`Was unable to load redis config from "${process.env['REDIS_CONF_PATH']}", Error: `, configLoadingException);
		redisConf       = undefined;
	}
} else if (process.env['REDIS_URI']) {
	redisConf           = process.env['REDIS_URI'];
}

const storage           = new StorageModule(redisConf);
// endregion

const fetcher           = require('./routes/fetcher');
const compiler           = require('./routes/compiler');
const app               = express();

app.options("/*", function(req, res, next){
	res.header('Access-Control-Allow-Origin', req.header('Origin') || '*');
	res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
	res.header('Access-Control-Allow-Headers', req.header('access-control-request-headers')
		|| '*');
	res.sendStatus(200);
});


app.use(logger('dev'));
app.use(express.static('public'))

app.use(fetcher(storage));
app.use(compiler(storage));


module.exports = app;
