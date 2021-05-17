// noinspection JSValidateJSDoc

/**
 * @author tht7 ( tht7 )
 * @date 15/05/2021 2:18 PM
 * This is the storage module, should have an independent API (not exposing redis or the filesystem or whatever) as to be simple to replace
 */
	
// region IMPORTS
const Redis                     = require('ioredis');   // the main module to connect to Redis with
const { Readable, Writable }    = require('stream');    // the stream library is used to implement the input and output streams
const uuid                      = require('uuid').v4;   // the UUID module is used to generate scriptId's if not supplied
const { getPureScriptId }       = require('../utils');  // getPureScriptId clears the extensions off of scriptId's
const { EventEmitter }          = require('events');
// endregion

// region CONSTANTS
const changePubSubChannel       = 'change-notification-channel';
const deletionPubSubChannel     = 'deletion-notification-channel';
// endregion

// region SETUP
// let redisConf = undefined; // declaration
// // if the REDIS CONF PATH variable is present that means that the user(DevOps) want's us to read the redis connection settings from some JSON file
// if ( process.env.REDIS_CONF_PATH ) {
// 	try {
// 		// we'll try to read and parse the config file
// 		redisConf = JSON.parse(fs.readFileSync(process.env.REDIS_CONF_PATH));
// 	} catch (configLoadingException) {
// 		console.error(`Was unable to load redis config from "${process.env.REDIS_CONF_PATH}", Error: `, configLoadingException);
// 		redisConf = undefined;
// 	}
// }

// endregion

// noinspection JSUnusedGlobalSymbols
class StorageModule extends EventEmitter {
	constructor(redisConfig) {
		super();
		/** @type {IORedis.Redis | IORedis} */
		this.redis              = new Redis(redisConfig); // uses defaults unless given configuration object
		this.redisListener      = this.redis.duplicate();
		this.redisListener.subscribe(changePubSubChannel, (err, count) => {});
		this.redisListener.subscribe(deletionPubSubChannel, (err, count) => {});
		
		this.redisListener.on('message', (channel, scriptId) => {
			let eventName       = null; // string declaration
			switch (channel) {
				case changePubSubChannel:
					eventName   = 'changed';
					break;
				case deletionPubSubChannel:
					eventName   = 'deleted';
					break;
			}
			if (eventName) {
				this.emit(eventName, scriptId);
			}
		})
	}
	
	/***
	 * Get the minified script from storage to stream to the client
	 * The stream object should contain the metadata if withMetadata is true
	 * @param {string} scriptId - the script ID to fetch from storage
	 * @param {boolean|true} withMetadata - this tells us if we should bother with the metadata
	 * @param {Date|number} lastChanged - this will tell us when the user last cached the script, potentially freeing us from fetching it
	 * @returns {Promise<ScriptReadableStream|number>} a compressed stream of the file or -2  if the file was not found or -1 if the script was not changed since the user last cached it
	 * @async
	 */
	async getScriptStream(scriptId, withMetadata = true, lastChanged = null) {
		let metadata            = null;
		if (withMetadata || !lastChanged) {
			// we'll need the metadata to know if the script is cached so we'll bring it anyway
			metadata            = await this.getScriptMetadata(scriptId);
			if (!metadata) {
				// metadata not found! probably the entire script doesn't exists
				return -2;
			}
		}
		if (lastChanged                 // the user supplied a "lastChanged" setting
			&& metadata                 // the metadata was fetched from the database
			&& metadata.lastChanged     // the metadata contained the last changed time
			&& metadata.lastChanged <= lastChanged) {
			// the last time that the script was changed is after the user has it cached
			return -1;
		}
		if (!metadata && !(await this.redis.exists(scriptId))) {
			// we didn't bring in the metadata and the EXISTS redis command returned false(0)
			return -2;
		}
		return new ScriptReadableStream(scriptId, metadata, this.redis);
	}
	
	/***
	 * Get's just the metadata of a script file
	 * @param {string} scriptId - the script ID to fetch from storage
	 * @returns {Promise<Object|null>} the script metadata (or null if the file was not found)
	 * @async
	 */
	async getScriptMetadata(scriptId) {
		let metadata            = await this.redis.hgetall(`META:${getPureScriptId(scriptId)}`);
		if (Object.keys(metadata||{}).length === 0)
			metadata            = null;
		return metadata;
	}
	
	/***
	 * Gives you back an Input Stream to the storage, this is how you can save a script,
	 * if the scriptId is already present in the storage, the old file will be overwritten
	 * @param {string|null} scriptId - the new scriptId, if not present the storage is free to choose and return it as .scriptId on the stream object
	 * @param {*} metadata - the metadata of this script
	 * @returns {ScriptWriteableStream} The stream into the storage
	 */
	putScriptStream(scriptId = null, metadata = null) {
		return new ScriptWriteableStream(scriptId, metadata, this);
	}
	
	/***
	 * Removes a script from storage
	 * @param {string} scriptId
	 * @returns {Promise<void>}
	 * @async
	 */
	async deleteScript(scriptId) {
		const pureKey           = getPureScriptId(scriptId);
		try {
			await this.redis
				.multi()
				.del(`META:${pureKey}`)
				.del(`${pureKey}.js`)
				.del(`${pureKey}.map`)
				.exec();
			this.emitDeletionNotification(scriptId);
		} catch (ignoreDeletionError) {}
	}
	
	async renameScript(oldScriptId, newScriptId) {
		const oldPureKey           = getPureScriptId(oldScriptId);
		const newPureKey           = getPureScriptId(newScriptId);
		
		try {
			await this.redis
				.multi()
				.rename(`META:${oldPureKey}`, `META:${newPureKey}`)
				.rename(`${oldPureKey}.js`, `${newPureKey}.js`)
				.rename(`${oldPureKey}.map`, `${newPureKey}.map`)
				.exec();
			this.emitDeletionNotification(oldScriptId);
		} catch (ignoreDeletionError) {}
	}
	
	emitChangeNotification(scriptId) {
		this.redis.publish(changePubSubChannel, scriptId);
	}
	
	emitDeletionNotification(scriptId) {
		this.redis.publish(deletionPubSubChannel, scriptId);
	}
}
module.exports                  = StorageModule;

class ScriptReadableStream extends Readable {
	/***
	 *
	 * @param {string} scriptId
	 * @param {*} metadata
	 * @param {IORedis.Redis | IORedis} redis
	 */
	constructor(scriptId, metadata = null, redis) {
		super({});
		this.redis              = redis;
		this.metadata           = metadata;
		this.scriptId           = scriptId;
		this.head               = 0;
	}
	
	_read(size) {
		if (size < 1000) {
			// it's not worth it to make a call to get anything less then 1kb
			size                = 4000;
		}
		this.redis.getrangeBuffer(this.scriptId, this.head, this.head + size, (error, buf) =>{
			if (!error) {
				if (buf.length  === 0)
					this.push(null);
				else
					this.push(buf);
				this.head += buf.length;
			} else {
				this.destroy(error);
			}
		})
	}

}

class ScriptWriteableStream extends Writable {
	/***
	 *
	 * @param {string} scriptId
	 * @param {*} metadata
	 * @param {StorageModule} storage
	 */
	constructor(scriptId, metadata = null, storage) {
		super({});
		/** @type {IORedis.Redis|IORedis|IORedis.Redis|IORedis.Cluster} */
		this.redis                        = storage.redis;
		this.storage                      = storage;
		this.metadata                     = metadata;
		this.scriptId                     = scriptId || '00-' + uuid() + '.js' ;
		this.metadataSaved                = false;
		
	}
	
	/**
	 * In newer node version this will run at the beginning of the stream, in older node versions this will only run at the end
	 * @param callback
	 * @private
	 */
	_construct(callback) {
		if (!this.metadataSaved) {
			this.metadataSaved            = true;
			if (!this.scriptId.endsWith('.map')) {
				if (!this.metadata)
					this.metadata         = {};
				this.metadata.lastChanged = Date.now();
				
				// commit metadata to the database
				this.redis.hmset(`META:${getPureScriptId(this.scriptId)}`, this.metadata, callback);
			} else {
				callback();
			}
		}
	}
	
	_write(chunk, encoding, callback) {
		this.redis.append(this.scriptId, chunk, (error)=> {
			return callback(error?error:null);
		});
	}
	
	_final(callback) {
		// save the metadata
		this.storage.emitChangeNotification(this.scriptId);
		return this._construct(callback);
	}
}
