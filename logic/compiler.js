/**
 * @author tht7 ( tht7 )
 * @date 16/05/2021 12:00 AM
 */
'use strict';

// region IMPORTS
const { Readable, Transform, pipeline } = require('stream');        // Used to turn the Buffer in the cache to a stream, and to create the cache and pass stream
const zlib                              = require('zlib');          // Used to Compress the data, and to unzip
const path                              = require('path');          // Used to handle the temps filesystem folders/files
const fs                                = require('fs');            // Used to handle the temps filesystem folders/files
const uuid                              = require('uuid').v4;       // Used to assign random ID's to new scripts
const magicNumber                       = require('file-type');     // Used to interrogate mystery files
const unzipper                          = require('unzipper');      // Used to unzip uploaded archives
const rimraf                            = require('rimraf');        // Used to clean off the temp folders
const googleClosureCompiler             = require('google-closure-compiler'); // Used to minify the scripts
const { getPureScriptId }               = require('./utils');
// endregion

// region DOCS
/***
 * @typedef SizeLimits
 * @type {Object}
 * @property {number} compressedSize    - The size limit in bytes of the script after minification and BR compression
 * @property {number} decompressedSize  - The size limit in bytes of the an archive after decompression
 * @property {number} minifiedSize      - The size limit in bytes of the script after minification
 * @property {number} uploadSize        - The size limit in bytes of any uploaded content
 */
// endregion

// region CONSTANTS
const allowedScriptExt                  = ['.js'];
const allowedScriptTypes                = ['text/javascript','application/x-javascript'];
const allowedArchiveTypes               = ['application/zip'];
const allowedMimeTypes                  = [...allowedScriptTypes, ...allowedArchiveTypes];
const filteredFilesAndDirectories       = ['__MACOSX', '\\.DS_Store', '\\.'];
const filteredFilesAndDirectoriesRegExp = new RegExp(`(${filteredFilesAndDirectories.map(x => '^'+x).join('|')})`)
// endregion

class Compiler {
	/***
	 * @param {StorageModule} storage   - The persistence module
	 * @param {string} tempDir          - The directory to be used as a tempDirectory
	 * @param {SizeLimits} sizeLimits
	 */
	constructor(storage, tempDir, sizeLimits) {
		this.storage                    = storage;
		this.tempDir                    = tempDir;
		this.sizeLimits                 = sizeLimits;
		// let's try to clear/creat the temp dir
		try {
			fs.mkdirSync(this.tempDir);
		}catch (ignoreTempDirErrors) {}
	}
	
	/**
	 *
	 * @param {Readable} inputFileStream
	 * @param {string|null} knownMimeType
	 * @param {*|null} extraMetadata
	 * @returns {Promise<string>}
	 */
	async minifyNewFile(inputFileStream, knownMimeType, extraMetadata) {
		if (knownMimeType
			&& !allowedMimeTypes.includes(knownMimeType)) {
			throw new Error(`Unknown filetype uploaded, ${knownMimeType}`);
		}
		const newScriptId               = `00-${uuid()}`;
		const tempDirPath               = path.resolve(this.tempDir+path.sep+newScriptId);
		const filePath                  = tempDirPath+path.sep+newScriptId;
		let jsFilesToMinify             = [];
		try {
			await this.saveFileToDisk(inputFileStream, tempDirPath, filePath)
			// at this point we should have a file on disk to interrogate
			if (!knownMimeType) {
				// black mystery file!
				knownMimeType           = (await magicNumber.fromFile(filePath) || {}).mime;
				if (!knownMimeType) {
					// here we reached the "end of the line" with the guessing game!
					// we'll assume it's a normal js file and roll with it
					knownMimeType       = allowedScriptTypes[0];
				}
			}
			if (allowedScriptTypes.includes(knownMimeType)) {
				// this *should* be a script file!
				// add this to the minification list as is
				jsFilesToMinify.push(filePath);
			}else if (allowedArchiveTypes.includes(knownMimeType)) {
				// this *should* be an archive!
				// so let's unzip it!
				jsFilesToMinify         = await this.decompressArchive(filePath, tempDirPath,knownMimeType);
				if (jsFilesToMinify.length=== 0) {
					// nothing to minify was found in the archive!!
					throw new Error('Archive was empty!');
				}
			} else {
				// wtf what is going on!
				// welll the user might've uploaded, say an image...
				// and he didn't specify a Content-Type header
				// so we saved the image to disk and guessed it was an image via it's magic number!
				throw new Error(`Unknown filetype uploaded, ${knownMimeType}`);
			}
			
			// At this point we
			//  1. made sure size limits are always conserved
			//  2. got a list of all the JS files we need to minify
			// So I think now is the time to invoke the Google-Closure-Compiler!
			await this._minifyJs(jsFilesToMinify, `${filePath}.min.js`, `${filePath}.map`);
			
			if (fs.statSync(`${filePath}.min.js`).size >= this.sizeLimits.minifiedSize) {
				throw new Error('Minified file is bigger then the limits allow');
			}
			
			await this.saveScriptToStorage(newScriptId, `${filePath}.min.js`, `${filePath}.map`, extraMetadata);
			
			return `${newScriptId}.js`;
		} finally {
			// CLEAR EVERYTHING!
			try {
				rimraf.sync(tempDirPath);
			} catch (ignoreTempDirectoryCleanError) {}
			
		}
	}
	
	async patchScriptFile(fileStream, knownMimeType, metadata, oldScriptId, password = null) {
		const oldMetadata = this.storage.getScriptMetadata(getPureScriptId(oldScriptId));
		if (!oldMetadata) {
			throw new Error('Script not found!');
		}
		
		// TODO properly salt the password!
		if (oldMetadata['password']
			&& oldMetadata['password'] !== password) {
			throw new Error('Incorrect password!');
		}
		
		const newScriptId = await this.minifyNewFile(fileStream, knownMimeType, metadata);
		
		await this.storage.deleteScript(oldScriptId);
		await this.storage.renameScript(newScriptId, oldScriptId);
		
		
	}
	
	async saveFileToDisk(inputFileStream, tempDirPath, filePath) {
		return new Promise((resolve, reject)=>{
			// this can throw! but I don't want to handle that here
			//  if this throws something horribly wrong happened, (like weird Linux permission issue, of out-of-space issue)
			fs.mkdirSync(tempDirPath);
			pipeline(
				inputFileStream,
				new FileSizeLimiter(this.sizeLimits.uploadSize || this.sizeLimits.decompressedSize),
				fs.createWriteStream(filePath),
				(streamError) => {
					if (streamError) {
						try {
							fs.unlinkSync(filePath);
						}catch (ignoreCleanupError) {}
						return reject(streamError);
					}
					return resolve();
				});
		});
	}
	async decompressArchive(inputFilePath, outputFolderPath, mimeType) {
		try { fs.mkdirSync(outputFolderPath) } catch (ignoreFolderAlreadyExistsError) {}
		let currentUncomressedSize      = 0;
		let outputScriptFilesList       = [];
		const zipStream                 = fs.createReadStream(inputFilePath).pipe(unzipper.Parse({ forceStream: true }));
		for await (const fileInArchive of zipStream) {
			const filename              = fileInArchive.path;
			const type                  = fileInArchive.type; // it's either 'Directory' or 'File'
			const size                  = fileInArchive.vars.uncompressedSize;
			const outputFilePath        = outputFolderPath + path.sep + filename;
			currentUncomressedSize     += size;
			if (currentUncomressedSize >= this.sizeLimits.decompressedSize) {
				try {
					rimraf.sync(outputFolderPath);
				} catch (ignoreTempFolderDeletionError) {}
				throw new Error('File too big!');
			}
			if (filename.match(filteredFilesAndDirectoriesRegExp)) {
				console.error(`Found "illgel" file in archive: ${filename}, IGNORED (${path.extname(filename)})`);
				fileInArchive.autodrain();
				continue;
			}
			if (type                    === 'Directory') {
				fs.mkdirSync(outputFilePath);
				fileInArchive.autodrain();
			}else {
				if (!allowedScriptExt.includes(path.extname(filename))) {
					// console.error(`Found "illgel" file in archive: ${filename}, IGNORED (${path.extname(filename)})`);
					
					fileInArchive.autodrain();
					continue;
				}
				try { fs.mkdirSync(outputFolderPath+path.sep+path.dirname(filename), {recursive:true});
				} catch (ignoreDirectoryAlreadyExistsError) {}
				outputScriptFilesList.push(outputFilePath);
				fileInArchive.pipe(fs.createWriteStream(outputFilePath));
			}
		}
		
		// at this point we have all that we need in an decompressed mode!
		return outputScriptFilesList;
	}
	_minifyJs(inputFilePaths, outputFilePath, outputMapPath = undefined) {
		return new Promise((resolve, reject)=>{
			const compiler              = new googleClosureCompiler.compiler({
				js: inputFilePaths,
				compilation_level: 'ADVANCED_OPTIMIZATIONS',
				// env: 'CUSTOM',
				// isolation_mode: 'IIFE',
				// warning_level: 'QUIET',
				// jscomp_off: 'externsValidation',
				// process_common_js_modules: true,
				// language_in: 'ECMASCRIPT_2018',
				// language_out: 'ECMASCRIPT_2018',
				// module_resolution: 'NODE',
				strict_mode_input: false,
				js_output_file: outputFilePath,
				create_source_map: outputMapPath
			});
			
			compiler.run((errCode, stdOutData, stdErrData) => {
				if (errCode            !== 0) {
					// Hmmm we hit an error state! let's clean this up
					try {
						fs.unlinkSync(outputFilePath);
						if (outputMapPath) {
							fs.unlinkSync(outputMapPath);
						}
					} catch (ignoreCleaningError) {}
					return reject(new Error(stdErrData));
				}
				
				// here we resolve!, everything went fine!
				return resolve(stdOutData);
			});
		});
	}
	saveScriptToStorage (scriptId, scriptFilePath, scriptFileMapPath, metadata) {
		let taskList = [];
		taskList.push(this._saveFileToStorage(`${scriptId}.js`, scriptFilePath, metadata));
		if (scriptFileMapPath) {
			taskList.push(this._saveFileToStorage(`${scriptId}.map`, scriptFileMapPath));
		}
		return Promise.all(taskList);
	}
	_saveFileToStorage(filename, filePath, metadata) {
		return new Promise((resolve, reject)=>{
			const storageInputStream = this.storage.putScriptStream(filename, metadata);
			pipeline(
				fs.createReadStream(filePath),
				zlib.createBrotliCompress({
					params: {
						[zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
						[zlib.constants.BROTLI_PARAM_QUALITY]: 9,
						[zlib.constants.BROTLI_PARAM_SIZE_HINT]: fs.statSync(filePath).size
					}
				}),
				storageInputStream,
				(streamError) => {
					if (streamError) {
						return reject(streamError);
					}
					return resolve();
				}
			)
		});
	}
}
module.exports                          = Compiler;

class FileSizeLimiter extends Transform {
	constructor(maxSize, streamOptions) {
		super(streamOptions);
		this.maxSize                    = maxSize;
		this.currentSize                = 0;
	}
	/**
	 *
	 * @param {Buffer} chunk
	 * @param {string} encoding
	 * @param {function} callback
	 * @private
	 */
	_transform(chunk, encoding, callback) {
		this.currentSize               += chunk.length
		if (this.currentSize           >= this.maxSize) {
			// we're past the maxLimit! abort
			return callback(new Error('File too big'));
		}
		return callback(null, chunk);
	}
	
	_flush(callback) {
		return callback();
	}
}
