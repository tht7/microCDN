/**
 * @author tht7 ( tht7 )
 * @date 15/05/2021 6:21 PM
 */
const { kb, mb }                = require('../utils');


/*
Im doing to implement the cache as a LRU cache with a *size* limit that can be defined by the DevOp
The cache will also contain the last changed date and the data itself
 */
class CacheNode {
	/***
	 * @param {string} scriptId         - The ID od the script this Cache node is holding
	 * @param {Buffer} scriptBuffer     - The Script itself in the form of a compressed Buffer
	 * @param {*} scriptMetadata        - The metadata object that this script has
	 * @param {CacheNode|null} nextNode - The next     node down the linked list
	 * @param {CacheNode|null} prevNode - The previous node up   the linked list
	 */
	constructor(scriptId, scriptBuffer, scriptMetadata, nextNode = null, prevNode = null) {
		this.scriptId          = scriptId;
		this.scriptBuffer      = scriptBuffer;
		this.scriptMetadata    = scriptMetadata;
		this.nextNode          = nextNode;
		this.prevNode          = prevNode;
	}
}

// noinspection JSUnusedGlobalSymbols
class LRU {
	/**
	 * @param {number} limit - the cache limit in bytes (you can use the constants mb and kb to represent this nicely)
	 */
	constructor(limit          = 100 * mb) {
		this.size              = 0;        // the current size of the cache in bytes
		this.limit             = limit;    // the cache limit in bytes
		/** @type {CacheNode} */
		this.head              = null;     // the head node in the cache (the most   used node as of now)
		/** @type {CacheNode} */
		this.tail              = null;     // the tail node in the cache (the most unused node as of now)
		/** @type {{string: CacheNode}} */
		this.cacheMap          = {};       // the HashMap part of the cache for sonic fast lookups
	}

	/**
	 * puts a new node in the cache
	 * @param {string} id
	 * @param {CacheNode} newNode
	 */
	_writeNode(id ,newNode) {
		this.ensureLimit();

		// update the linked list part
		if (!this.head) {
			this.head          = this.tail = newNode;
		} else {
			newNode.nextNode   = this.head;
			this.head.prevNode = newNode;
			this.head          = newNode;
		}

		// update the hash-map part
		this.cacheMap[id]      = this.head;
		this.size             += this.head.scriptBuffer.length;
	}

	writeScript(scriptId, scriptBuffer, scriptMetadata) {
		return this._writeNode(scriptId, new CacheNode(scriptId, scriptBuffer, scriptMetadata));
	}

	read(scriptId) {
		if (this.cacheMap[scriptId]) {
			const node         = this.cacheMap[scriptId];

			// remove it from the cache
			this.remove(scriptId);
			// then reinsert it (as the latest)
			this._writeNode(scriptId, node);

			return node;
		}
		// Sorry we don't have the thing you're looking for
		return null;
	}

	ensureLimit() {
		while (this.size      >= this.limit) {
			this.remove(this.tail.scriptId);
		}
	}

	remove(scriptId) {
		/** @type {CacheNode} */
		const node             = this.cacheMap[scriptId];
		if (!node) return;
		if (node.prevNode     !== null) {
			node.prevNode.nextNode = node.nextNode;
		} else {
			this.head          = node.nextNode;
		}
		if (node.nextNode     !== null) {
			node.nextNode.prevNode = node.prevNode;
		} else {
			this.tail          = node.prevNode;
		}

		delete this.cacheMap[scriptId];
		this.size             -= node.scriptBuffer.length;
	}
}

module.exports                 = {
	Node : CacheNode,
	Cache: LRU
}
