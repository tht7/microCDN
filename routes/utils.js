/**
 * @author tht7 ( tht7 )
 * @date 17/05/2021 12:48 PM
 */
// region HELPERS

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

function setHeaders(response, metadata, scriptId, compressed = true) {
	const headersFromMeta       = getHeadersFromMetadata(metadata);
	Object.keys(headersFromMeta)
		.forEach(headerName     => response.setHeader(headerName, headersFromMeta[headerName]));
	response.setHeader('X-File-Id', scriptId);
	if (!headersFromMeta['Cache-Control']) {
		response.setHeader('Cache-Control', 'public');
	}
	if (!headersFromMeta['Access-Control-Allow-Origin']) {
		response.setHeader('Access-Control-Allow-Origin', '*');
	}
	response.contentType('text/javascript');
	
	if (metadata) {
		if (metadata.Expires)
			response.setHeader('Expires', new Date(metadata.Expires).toUTCString());
		if (metadata.lastChanged)
			response.setHeader('Last-Changed', new Date(metadata.lastChanged).toUTCString());
	}
	
	if (compressed) {
		response.setHeader('Content-Encoding', 'br');
	}
}

// endregion


module.exports = {
	getHeadersFromMetadata,
	setHeaders
}
