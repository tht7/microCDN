/**
 * @author tht7 ( tht7 )
 * @date 19/05/2021 3:48 PM
 */
// region CONSTANTS
/**
 * The base url of the API server, in prod this should be '/'
 * and in testing we can set this up to be whatever we'd want
 * @type {string}
 */
let basePoint       = '/';

// endregion
/**
 * localStorage['myScripts'] should be a list of "tracked" scriptId's
 */
const rawScriptStorage = {
	/**
	 *  * @type {string[]}
	 */
	current: null,
	get() {
		let cu = this.current || JSON.parse(localStorage['myScripts'] ?? '[]');
		this.current = cu;
		return cu;
	},
	push (newScriptId) {
		if (this.current.indexOf(newScriptId) !== -1) return;
		this.current.push(newScriptId)
		this.save();
	},
	remove(scriptId) {
		const indexOfScript = this.current.indexOf(scriptId);
		if (indexOfScript === -1) return;
		this.current.splice(indexOfScript, 1);
		this.save();
	},
	save() {
		localStorage['myScripts'] = JSON.stringify(this.current);
	}
}
// region NEW-FETCH
/**
 * Saving up the old fetch
 * @type {function(...[*]): *}
 */
const ogFetch       = fetch;
/**
 * Keeping up with how many fetch requests are "live" now
 *  so we won't toggle the loading off before the last one came home
 * @type {number}
 */
let fetcherCounter  = 0;
/**
 * Making a new "fetch" that will toggle the loading for me.
 * This is not a great solution in a big project, but here it will do wonderfully
 * @param args
 * @returns {Promise<Response>}
 */
fetch = async (...args) => {
	fetcherCounter++;
	Vue.set(app, 'showLoading', true);
	const res = await ogFetch(...args);
	Vue.set(app, 'showLoading', --fetcherCounter > 0);
	return res;
};
// endregion

// region COMPONENT:fab-button
Vue.component('fab-button', {
	data: ()=>({
		isOpen: false
	}),
	template: `<v-speed-dial
				v-model="isOpen"
                bottom
                right
                open-on-hover
                absolute
        >
            <template v-slot:activator>
                <v-btn
                        v-model="isOpen"
                        color="blue darken-2"
                        dark
                        fab
                >
                    <v-icon v-if="isOpen">
                        mdi-close
                    </v-icon>
                    <v-icon v-else>
                        mdi-plus
                    </v-icon>
                </v-btn>
            </template>
            <v-btn
                    fab
                    dark
                    small
                    color="green"
                    @click="$emit('open-add-tracking-dialog')"
            >
                <v-icon>mdi-plus</v-icon>
            </v-btn>
            <v-btn
                    fab
                    dark
                    small
                    color="indigo"
                    @click="$emit('open-upload-dialog')"
            >
                <v-icon>mdi-cloud-upload-outline</v-icon>
            </v-btn>
        </v-speed-dial>`
});
// endregion

// region COMPONENT:upload-dialog
Vue.component('upload-dialog', {
	props: [
		'isOpen',
		'scriptId',
		'scriptMeta',
		'p_scriptCode',
	],
	data: () => ({
		isLoading: false,
		scriptCode: null,
		/**
		 * @type {File}
		 */
		scriptFile      : null,
		formDefault     : Object.freeze({
			'X-Name'                             : '',
			'X-Debug'                            : true,
			'X-Password'                         : null,
			'X-Cache-Control'                    : 'public',
			'X-Expires'                          : null,
			'X-Access-Control-Allow-Origin'      : '*'
		}),
		form: Object.assign({}, this.formDefault)
	}),
	watch: {
		scriptMeta: function(newVal, oldVal) { // watch it
			Vue.set(this, 'form', newVal || Object.assign({}, this.formDefault));
		},
		p_scriptCode: function(newVal, oldVal) { // watch it
			Vue.set(this, 'scriptCode', newVal);
		},
		isOpen: function(newVal, oldVal) { // watch it
			if (!oldVal && newVal) {
				Vue.set(this, 'scriptFile', null);
			}
			Vue.set(this, 'isOpen', newVal);
		},
	},
	methods: {
		collectHeaders () {
			if (!this.form["X-Cache-Control"] || this.form["X-Cache-Control"] === ''){
				this.form["X-Cache-Control"] = 'public';
			}
			if (!this.form["X-Access-Control-Allow-Origin"]
				|| this.form["X-Access-Control-Allow-Origin"] === '') {
				delete this.form['X-Access-Control-Allow-Origin'];
			}
			
			if (this.form["X-Expires"] === null
				|| this.form["X-Expires"] === '') {
				delete this.form['X-Expires'];
			}
			if (this.form["X-Name"] === null
				|| this.form["X-Name"] === '') {
				delete this.form['X-Name'];
			}
			
			if (this.form["X-Password"] === null
				|| this.form["X-Password"] === '') {
				delete this.form['X-Password'];
			}
			
			this.form['Content-Type'] = (this.scriptFile||{}).type || 'text/javascript';
			return this.form;
		},
		async upload () {
			Vue.set(this, 'isLoading', true);
			let requestUrl = basePoint;
			if (this.scriptId) {
				// we're in edit mode and we should PUT this script
				requestUrl += this.scriptId;
			}
			try {
				/** @type {Response} */
				const response = await fetch(requestUrl, {
					method: this.scriptId ? 'PUT' : 'POST',
					headers: this.collectHeaders(),
					body: this.scriptCode || this.scriptFile
				});
				if (response.status === 200) {
					if (!this.scriptId) {
						this.$emit('new-script', response.headers.get('X-File-ID'));
					}
				} else if (response.status === 403) {
					this.$emit('error', {
						errorTitle  : 'Access Denied',
						errorBody   : 'Wrong password!'
					});
				} else {
					this.$emit('error', {
						errorTitle  : 'Oh no, script upload error',
						errorBody   : await response.text()
					});
				}
			} catch (/*Error*/scriptUploadingError) {
				this.$emit('error', {
					errorTitle  : 'Oh no, script upload error',
					errorBody   : scriptUploadingError.message
				});
				console.error(scriptUploadingError);
			}
			Vue.set(this, 'isLoading', false);
			this.$emit('close');
		},
		highlighter(code) {
			// js highlight example
			return Prism.highlight(code, Prism.languages.js, "js");
		}
	},
	template: `
	  <v-dialog
        v-model="isOpen"
        v-on:click:outside="$emit('close')"
        width="500">
    <v-card>
      <v-card-title class="headline grey lighten-2">
        Upload a new script
      </v-card-title>

      <v-card-text>
        <v-form
            @submit.prevent="upload">
          <prism-editor
	          v-if="scriptCode"
	          class="my-editor height-200"
	          v-model="scriptCode"
	          v-bind:highlight="highlighter"
	          line-numbers></prism-editor>
          <v-file-input
              label="Upload a script file or an archive"
              v-model="scriptFile"
              accept="application/zip,text/javascript"
          />
          <v-text-field
              label="Name"
              prepend-icon="mdi-script"
              v-model="form['X-Name']"
          />
          <v-text-field
              label="Password"
              hint="This password will make sure no-one can edit this script but you"
              prepend-icon="mdi-form-textbox-password"
              v-model="form['X-Password']"
              type="password"
          />
          <v-text-field
              label="Cache control Header"
              hint="This header will be delivered to your users when they download this script to help them cache it correctly"
              prepend-icon="mdi-cached"
              v-model="form['X-Cache-Control']"
          />
          <v-text-field
              label="Expires Header"
              hint="This header will be delivered to your users when they download this script to help them cache it correctly"
              prepend-icon="mdi-cached"
              v-model="form['X-Expires']"
          />
          <v-text-field
              label="Cross control header"
              hint="This will let you limit the use of this script to a certain domain (not strictly enforced)"
              prepend-icon="mdi-access-point-off"
              v-model="form['X-Access-Control-Allow-Origin']"
          />
            <v-checkbox
                label="Generate map files"
                hint="Generating Map files will allow easier debugging"
                v-model="form['X-Debug']"
            />
        </v-form>
      </v-card-text>

      <v-divider></v-divider>

      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn
            color="primary"
            text
            @click="upload"
        >
          Upload
        </v-btn>
      </v-card-actions>
    </v-card>
    <v-dialog
        v-model="isLoading"
        hide-overlay
        persistent
        width="300"
    >
      <v-card
          color="primary"
          dark
      >
        <v-card-text>
          Please stand by uploading script
          <v-progress-linear
              indeterminate
              color="white"
              class="mb-0"
          ></v-progress-linear>
        </v-card-text>
      </v-card>
    </v-dialog>
    </v-dialog>`
});
// endregion

// region COMPONENT:delete-dialog
Vue.component('delete-dialog',{
	props: [
		'scriptId',
		'scriptMeta',
	],
	data: ()=>({
		password: '',
		show: true,
	}),
	methods: {
		async deleteScript() {
			try {
				const request = {
					method: 'DELETE'
				};
				if (this.password && this.password !== '') {
					request.headers = {
						'X-Password': this.password
					}
				}
				const response = await fetch(`${basePoint}${this.scriptId}`,request);
				switch (response.status) {
					case 403:
						this.$emit('error', {
							errorTitle  : 'Access Denied',
							errorBody   : 'Wrong password!'
						});
						break;
					case 500:
						this.$emit('error', {
							errorTitle  : 'Server Error',
							errorBody   : await response.text()
						});
						break;
					case 200:
						this.$emit('remove-script', this.scriptId);
				}
				
			} catch (deletionError) {
				console.error(deletionError);
				this.$emit('error', {
					errorTitle  : 'An error happened while deleting the script',
					errorBody   : deletionError.message
				});
			}
			this.$emit('close');
		}
	},
	computed: {
		showPassword() {
			return (this.scriptMeta||{password:false}).password;
		}
	},
	template: `
      <v-dialog
          color="red"
          v-model="show"
          v-on:click:outside="$emit('close')"
          transition="dialog-bottom-transition"
          width="500">
      <v-card>
        <v-toolbar
            color="red"
            dark
        >DELETE SCRIPT</v-toolbar>
        <v-card-text>
          Are you sure you want to delete: {{ (this.scriptMeta||{}).name || this.scriptId }}?
          <v-text-field
	          v-if="showPassword"
              label="Password"
              prepend-icon="mdi-form-textbox-password"
              v-model="password"
              type="password"
          />
        </v-card-text>
        <v-card-actions class="justify-end">
          <v-btn
              text
              @click="$emit('close')"
          >Close</v-btn>
          <v-btn
              text
              color="red"
              @click="deleteScript"
          >Yes</v-btn>
        </v-card-actions>
      </v-card>
      </v-dialog>
	`
});
// endregion

// region COMPONENT:error-dialog
Vue.component('error-dialog', {
	props: [
		'error',
		'showError'
	],
	template: `
		<v-dialog
			color="red"
            v-model="showError"
            v-on:click:outside="$emit('close')"
            transition="dialog-bottom-transition"
            width="500">
	        <v-card>
	          <v-toolbar
	              color="red"
	              dark
	          >{{ (error||{}).errorTitle }}</v-toolbar>
	          <v-card-text>
	            {{ (error||{}).errorBody }}
	          </v-card-text>
	          <v-card-actions class="justify-end">
	            <v-btn
	                text
	                @click="$emit('close')"
	            >Close</v-btn>
	          </v-card-actions>
	        </v-card>
		</v-dialog>
	`
})
// endregion

// region COMPONENT:add-tracking-dialog
Vue.component('add-script-to-list-dialog', {
	props: [ 'isOpen' ],
	data: ()=>({
		scriptId: ''
	}),
	template: `
		<v-dialog
            v-model="isOpen"
            v-on:click:outside="$emit('close')"
		>
	        <v-card>
	          <v-toolbar
	              color="primary"
	              dark
	          >Track another script</v-toolbar>
	          <v-card-text>
	            This let's you add another script to the list even if you're not the one that uploaded it
                <v-text-field
                    label="Script ID"
                    prepend-icon="mdi-script"
                    v-model="scriptId"
                />
	          </v-card-text>
	          <v-card-actions class="justify-end">
	            <v-btn
	                text
	                @click="$emit('close')"
	            >Close</v-btn>
                <v-btn
                    text
                    @click="$emit('new-script', scriptId);$emit('close')"
                >Add</v-btn>
	          </v-card-actions>
	        </v-card>
		</v-dialog>
	`
})
// endregion


let app = new Vue({
	el      : '#vueApp',
	vuetify : new Vuetify(),
	data    : {
		/**
		 * @type {{errorTitle:string, errorBody:string}}
		 */
		error                : null,
		showErrorDialog      : false,
		showLoading          : false,
		showUploadDialog     : false,
		showInfoDialog       : false,
		showAddTrackingDialog: false,
		showDeleteDialog     : false,
		scriptToEdit         : null,
		scriptMetadataToEdit : null,
		scriptCodeToEdit     : null,
		myScripts            : {}
	},
	methods : {
		//region HELPERS
		keys: Object.keys,
		// endregion
		async setUp() {
			await Promise.all(rawScriptStorage.get().map( this.fetchScriptMetadata ));
		},
		async addScriptIdToTrack(scriptId) {
			if (!scriptId || scriptId === '') {
				return;
			}
			
			rawScriptStorage.push(scriptId);
			return this.fetchScriptMetadata(scriptId);
		},
		removeFromTracking(scriptId) {
			rawScriptStorage.remove(scriptId);
			Vue.delete(this.myScripts, scriptId);
		},
		async fetchScriptMetadata(scriptId) {
			const res = await fetch(`${basePoint}meta/${scriptId}`);
			if (res.status !== 200 ) {
				rawScriptStorage.remove(scriptId);
				this.showError({
					errorTitle  : 'Script not found!',
					errorBody   : `The script ${scriptId} wasn't found on the server, it might've been deleted!, \n I'll remove it from tracking`
				})
				return;
			}
			Vue.set(this.myScripts, scriptId, await res.json());
			console.log(this.myScripts);
		},
		showError(error) {
			Vue.set(this, 'error', error);
			Vue.set(this, 'showErrorDialog', true);
		},
		showDelete(scriptId) {
			Vue.set(this, 'scriptToEdit', scriptId);
			Vue.set(this, 'scriptMetadataToEdit', this.myScripts[scriptId]);
			Vue.set(this, 'showDeleteDialog', true);
		},
		async showEdit(scriptId) {
			Vue.set(this, 'scriptToEdit', scriptId);
			if (!scriptId) {
				Vue.set(this, 'scriptMetadataToEdit', null);
				Vue.set(this, 'scriptCodeToEdit', null);
			} else {
				Vue.set(this, 'scriptMetadataToEdit', this.myScripts[scriptId]);
				const code  = await (await fetch(`${basePoint}source/${scriptId}`)).text();
				console.log(code);
				Vue.set(this, 'scriptCodeToEdit', code);
			}
			Vue.set(this, 'showUploadDialog', true);
		}
	},
	computed: {
		isTrackingListEmpty() {
			return Object.keys(this.myScripts).length === 0;
		}
	},
	mounted () {
		this.$nextTick(this.setUp);
	}
})
