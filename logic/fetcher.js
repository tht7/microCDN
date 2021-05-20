/**
 * @author tht7 ( tht7 )
 * @date 15/05/2021 8:33 PM
 * Ok time to make a BATTLE PLAN:
 * this module needs to have 3 main parts:
 * 1. the storage
 * 2. the cache
 * 3. the "glue"
 *
 * I want the storage to be swappable but fast
 * I want the cache to be minimal
 * I want the glue to be easy to read and modify, for the future developer this should be the entry point
 *
 * This module has one "hot-path", SERVE
 */
// region IMPORTS
const { Readable, Transform }           = require('stream'); // Used to turn the Buffer in the cache to a stream, and to create the cache and pass stream
const zlib                              = require('zlib');   // Used to Decompress the data if the user chooses so
const { getPureScriptId }               = require('./utils');// Used to clean a script off the cache when receiving a change notification
// endregion


class Fetcher {
	/**
	 *
	 * @param {LRU|null}cache
	 * @param {StorageModule} storage
	 */
	constructor(cache, storage) {
		this.cache                      = cache;
		this.storage                    = storage;
		const notificationReaction      = (scriptId) => {
			if (this.cache) {
				const pureId            = getPureScriptId(scriptId);
				this.cache.remove(`${scriptId}.js`);
				this.cache.remove(`DECOMPRESSED:${scriptId}.js`);
			}
		}
		
		this.storage.on('change' , notificationReaction);
		this.storage.on('deleted', notificationReaction);
	}
	
	/**
	 *
	 * @param {string} scriptId
	 * @param {Date|number|null} lastCached
	 * @param {boolean} deCompress
	 * @returns {Promise<Stream|number>} if the user already has this cached then we'll return -1
	 */
	async getScriptReadStream(scriptId, lastCached = 0, deCompress = false) {
		let scriptFileStream            = null;
		const isMap                     = scriptId.endsWith('.map');
		const computedScriptId          = deCompress? `DECOMPRESSED:${scriptId}` : scriptId;
		if (!isMap && this.cache) {
			let needsDecompression      = false;
			/** @type {CacheNode|null} */
			let cachedScript            = this.cache.read(computedScriptId);
			if (deCompress && !cachedScript) {
				// if we couldn't find the decompressed version of this script in the cache maybe we can find the regular one
				//      then decompress it and put it back in
				cachedScript            = this.cache.read(scriptId);
				if (cachedScript) {
					needsDecompression  = true;
				}
			}
			if (lastCached
				&& cachedScript
				&& cachedScript.scriptMetadata
				&& cachedScript.scriptMetadata.lastChanged
				&& cachedScript.scriptMetadata.lastChanged <= lastCached) {
				return -1;
			}
			if (cachedScript) {
				// scriptFileStream = // Readable.from(cachedScript.scriptBuffer);
				scriptFileStream    = new Readable();
				scriptFileStream._read = ()=>{};
				scriptFileStream.push(cachedScript.scriptBuffer);
				scriptFileStream.push(null);
				if (needsDecompression) {
					scriptFileStream    = this.streamDecompress(scriptFileStream, computedScriptId, cachedScript.scriptMetadata);
					// let's add this script to the cache
					scriptFileStream    = this.cacheStream(scriptFileStream, computedScriptId, cachedScript.scriptMetadata);
				}
			}
			
		}
		if (!scriptFileStream) {
			// OOF here we have a cache MISS
			scriptFileStream            = await this.storage.getScriptStream(scriptId, !isMap, lastCached);
			if (typeof scriptFileStream === 'number') {
				// we hit some error state
				//    it could be -1 (user already has file cached, according  to the supplied "lastCached")
				// or it could be -2 (script not found, will only prop up if isMap=false or "lastCached" was supplied)
				// if none of those were supplied
				//     (aka isMap is true and no "lastCached" was supplied)
				//     it will return a readable stream with 0 bytes
				// which means that the users won't reach the 0b stream (since that only happens to developers asking for map files)
				return scriptFileStream;
			}
			if (deCompress) {
				scriptFileStream        = this.streamDecompress(scriptFileStream,
																computedScriptId,
																scriptFileStream.metadata);
			}
			if (!isMap && this.cache) {
				// let's add this script to the cache
				scriptFileStream        = this.cacheStream(scriptFileStream,
														   computedScriptId,
														   scriptFileStream.metadata);
			}
		}
		return scriptFileStream;
	}
	
	async getScriptMetadata(scriptId) {
		const pureId                    = getPureScriptId(scriptId);
		if (this.cache) {
			/** @type {CacheNode|null} */
			const cachedNode            = this.cache.read(`${pureId}.js`);
			if (cachedNode) {
				return cachedNode.scriptMetadata;
			}
		}
		
		return this.storage.getScriptMetadata(`${pureId}.js`);
	}
	
	streamDecompress(stream, scriptId, metadata) {
		const decompressionPipe         = zlib.createBrotliDecompress();
		stream.pipe(decompressionPipe);
		decompressionPipe.metadata      = metadata;
		decompressionPipe.scriptId      = scriptId;
		return decompressionPipe;
	}
	
	cacheStream(stream, scriptId, metadata) {
		const cacheingPipethrou         = new CacheAndPassThro(this.cache,
																scriptId, metadata);
		stream.pipe(cacheingPipethrou);
		return cacheingPipethrou;
	}
}

class CacheAndPassThro extends Transform {
	/**
	 *
	 * @param {LRU} cache
	 * @param {string} scriptId
	 * @param {*} scriptMetadata
	 */
	constructor(cache, scriptId, scriptMetadata) {
		super();
		this.cache                      = cache;
		this.scriptId                   = scriptId;
		this.metadata                   = scriptMetadata;
		this.tempBuffers                = [];
	}
	
	_transform(chunk, encoding, callback) {
		this.tempBuffers.push(chunk);
		return callback(null, chunk);
	}
	
	_flush(callback) {
		this.cache.writeScript(this.scriptId, Buffer.concat(this.tempBuffers), this.metadata);
		return callback();
	}
}

module.exports                          = Fetcher;
