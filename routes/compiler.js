/**
 * @author tht7 ( tht7 )
 * @date 17/05/2021 11:17 AM
 */
// region IMPORTS
const express                           = require('express');
const path                              = require('path');
const os                                = require('os');
const Compiler                          = require('../logic/compiler');
const Fetcher                           = require('../logic/fetcher');
const{ kb, mb, getHeadersFromMetadata } = require('../logic/utils');
const { setHeaders }                    = require('./utils');
// endregion

// region CONSTS AND SETTINGS
const tempdir                           = (process.env['MICROCDN_TEMPDIR'] || os.tmpdir()) + path. sep + 'microCdn';
const sizeLimits                        = {
	compressedSize      : process.env['MICROCDN_COMPRESSED_SIZE_LIMIT']     || 10 * mb,
	decompressedSize    : process.env['MICROCDN_DECOMPRESSED_SIZE_LIMIT']   || 30 * mb,
	minifiedSize        : process.env['MICROCDN_MINIFIED_SIZE_LIMIT']       || 10 * mb,
	uploadSize          : process.env['MICROCDN_UPLOAD_SIZE_LIMIT']         || 40 * mb,
};
// endregion
// region HELPERS
function includesIFExists(object, key, value) {
	// remember that value can be 0 and still be included!
	if (value                          !== ''
		&& value                       !== null
		&& value                       !==  undefined) {
		object[key]                     = value;
	}
}

function collectMetadata(req) {
	const metadata                      = {};
	includesIFExists(metadata, 'X-Access-Control-Allow-Origin', req.header('X-Access-Control-Allow-Origin'));
	includesIFExists(metadata, 'X-Cache-Control', req.header('X-Cache-Control'));
	includesIFExists(metadata, 'X-Expires', req.header('X-Expires'));
	includesIFExists(metadata, 'password', req.header('X-Password'));
	return metadata;
}
// endregion
/**
 *
 * @param {StorageModule} storage
 * @returns {Router}
 */
function createRouter(storage) {
	const compiler                      = new Compiler(storage, tempdir, sizeLimits);
	const fetcher                       = new Fetcher(null, storage);
	const router                        = new express.Router();
	/**
	 * posting a script file / ziped folder here should (unzip the archive and colloect the JS files from within it)
	 * minify the JS file(s)
	 * Save them to storage
	 * and serve them back up with a new X-File-id header
	 */
	router.post('/', async function (req, res) {
		// let's collect all the metadata!
		const metadata                  = collectMetadata(req);
		try {
			const newScriptId = await compiler.minifyNewFile(req, (req.header('Content-Type') || '').split(';')[0], metadata);
			res.status(200).contentType('text/javascript');
			const needsDecompression    = !req.acceptsEncodings('br');
			setHeaders(res, metadata, newScriptId, !needsDecompression);
			(await fetcher.getScriptReadStream(newScriptId, null, needsDecompression)).pipe(res);
		} catch (complingError) {
			console.error(complingError);
			res.status(complingError.code || 500).write(complingError.message).end();
		}
		
	});
	
	/**
	 * putting a script file / ziped folder here should (unzip the archive and colloect the JS files from within it)
	 * minify the JS file(s)
	 * Save them to storage with the same FileId as the one that was supplied
	 * and serve them back up
	 */
	router.put('/:fileId', async function (req, res) {
		// let's collect all the metadata!
		const metadata                  = collectMetadata(req);
		const fileId                    = req.params['fileId'];
		try {
			const newScriptId           = await compiler.patchScriptFile(req, (req.header('Content-Type') || '').split(';')[0], metadata, fileId, metadata['password']);
			res.status(200);
			const needsDecompression    = !req.acceptsEncodings('br');
			setHeaders(res, metadata, fileId, !needsDecompression);
			const scriptStream          = (await fetcher.getScriptReadStream(fileId, null, needsDecompression));
			if (typeof scriptStream     === 'number') {
				// some error happened here
				// this could only be -1 for "already cached"
				// or -2 for not found!
				console.error('Stream Error', scriptStream);
				throw new Error(`Stream Error ${scriptStream}`);
			}
			scriptStream.pipe(res);
		} catch (complingError) {
			console.error(complingError);
			res.status(complingError.code || 500).write(complingError.message);
			res.end();
		}
	});
	
	router.delete('/:fileId', async function (req, res) {
		// let's collect all the metadata!
		const metadata                  = collectMetadata(req);
		const fileId                    = req.params['fileId'];
		try {
			const metadata              = await storage.getScriptMetadata(fileId);
			if (!metadata) {
				return res.status(404).end();
			}
			if (metadata['password']
				&& metadata['password'] !== req.header('X-Password')) {
				return res.status(403).end();
			}
			
			await storage.deleteScript(fileId);
			
			return res.status(200).end();
		} catch (deletionError) {
			console.error(deletionError);
			res.status(deletionError.code || 500).write(deletionError.message);
			res.end();
		}
	});
	return router;
}


module.exports = createRouter;
