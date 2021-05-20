/**
 * @author tht7 ( tht7 )
 * @date 15/05/2021 8:17 PM
 */

// region IMPORTS
const express           = require('express');                           // the express framework(?)
const router            = new express.Router();                         // the exported router
const Fetcher           = require('../logic/fetcher');                  // the logic unit that drives this "implementation"
const StorageModule     = require('../logic/storage/storage_redis');    // the persistence module
const Cache             = require('../logic/cache/LRU').Cache;          // the caching module
const { kb, mb, getPureScriptId } = require('../logic/utils');   // some units (those stand for MegaBytes and Kilo-Bytes)
const { setHeaders, getHeadersFromMetadata }    = require('./utils');                           // used to set the headers, shared with the compiler routes
// endregion
function getRoute(storage) {
// region SETUP
	const cachingLimit  = parseInt(process.env['NODE_CACHING_LIMIT']) || 100*mb;
	const cache         = new Cache(cachingLimit);
	const fetcher       = new Fetcher(cache, storage);
// endregion
	/**
	 * Getting the script files
	 */
	router.get('/:fileId', function (req, res) {
		/* Battle plan:
		extract from the headers if the user supports compression, or if the user already has the file cached (with Cache-Control headers)
		 */
		const needsDecompression = !req.acceptsEncodings('br');
		const lastModified = Date.parse(req.header('If-Modified-Since'));
		const fileId = req.params['fileId'];
		fetcher.getScriptReadStream(fileId, lastModified, needsDecompression)
			.then(scriptFileStream => {
				if (typeof scriptFileStream === 'number') {
					// this is not a streammmmm, it's an error
					if (scriptFileStream === -1) {
						// CACHE CONTROL HIT!
						return res.status(304).end();
					} else if (scriptFileStream === -2) {
						// Wops script not found!
						return res.status(404).end();
					}
				}
				// ok at this point all we have to do is
				//  1. add the cache control headers
				//  2. add personal headers
				//  3. shoot down the file to the user!
				res.status(200);
				setHeaders(res, scriptFileStream.metadata, fileId, !needsDecompression);
				
				scriptFileStream.pipe(res);
			});
	});
	
	/**
	 * Getting the metadata for a script
	 */
	router.get('/meta/:fileId', function (req, res) {
		const lastModified = Date.parse(req.header('If-Modified-Since'));
		const fileId = req.params['fileId'];
		fetcher.getScriptMetadata(fileId)
			.then(scriptMetadata => {
				if (!scriptMetadata) {
					// wops not found!
					return res.status(404).end();
				}
				// Important!! don't send the password to the client! but I want to send a bool if there is a password!
				scriptMetadata.password = !!scriptMetadata.password;
				res.status(200).json(scriptMetadata).end();
			});
	});
	
	/**
	 * Getting the source for a script
	 */
	router.get('/source/:fileId', async function (req, res) {
		const fileId                    = req.params['fileId'];
		const lastModified              = Date.parse(req.header('If-Modified-Since'));
		const needsDecompression        = !req.acceptsEncodings('br');
		let scriptFileStream            = await fetcher.getScriptReadStream(`SOURCE:${getPureScriptId(fileId)}`, lastModified, needsDecompression);
		console.log(scriptFileStream);
		if (typeof scriptFileStream     === 'number') {
			// this is not a streammmmm, it's an error
			if (scriptFileStream        === -1) {
				// CACHE CONTROL HIT!
				return res.status(304).end();
			} else if (scriptFileStream === -2) {
				// Wops script not found!
				 scriptFileStream       = await fetcher.getScriptReadStream(`${getPureScriptId(fileId)}.js`, lastModified, needsDecompression);
			}
		}
		if (typeof scriptFileStream     === 'number') {
			if (scriptFileStream        === -2) {
				// Wops script not found!
				return res.status(404).end();
			}
		}
		res.status(200);
		setHeaders(res, scriptFileStream.metadata, fileId, !needsDecompression);
		scriptFileStream.pipe(res);
	});
	return router;
}

module.exports = getRoute;
