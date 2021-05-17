/**
 * @author tht7 ( tht7 )
 * @date 15/05/2021 8:10 PM
 */
// region CONSTANTS
const kb                       = 1000;
const mb                       = kb * 1000;
// endregion
// region HELPERS
/**
 * I will usually attach a ".js" or similar to script files in the database (to signify they're files)
 * This will clear the extension to use for more generic stuff
 * @param {string} scriptId
 * @returns {string} the clear no-extension scriptId
 */
function getPureScriptId(scriptId) {
	return scriptId
		.replace(/\..{2,3}$/, '')
		.replace(/^DECOMPRESSED:/, '');
}

function makeError(message, code, type = Error) {
	const newErr = new (type || Error)(message);
	newErr.code = code;
	newErr.status = code;
	return newErr;
}

/**
 * in the metadata all the field that start with X- should be returned to the user as headers
 * This will collect and filter them up
 * @param metadata
 * @returns {Object}
 */
function getHeadersFromMetadata(metadata) {
	if (metadata) {
		const headersObject = {};
		Object.keys(metadata)
			.filter(keyName => keyName.startsWith('X-'))
			.forEach(keyName => {
				headersObject[keyName.replace(/^X\-/, '')] = metadata[keyName];
			});
		return headersObject;
	}
	return {};
}
// endregion


module.exports = {
	getPureScriptId,
	makeError,
	getHeadersFromMetadata,
	kb,
	mb
}
