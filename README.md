#Micro CDN

#Start up
in order to start the server up just run
```bash
npm i
npm run start
```

##Configuration
Almost all the config is taken from the environment



| Variable name        | Purpose          |
| ------------- |:-------------:|
| PORT      | The port to which express will listen|
| SSL_KEY_PATH      | The Path to the SSL private key ( if not supplied a self signed key will be used )|
| SSL_CERT_PATH      | The Path to the SSL certificate ( if not supplied a self signed certificate will be used )|
| REDIS_CONF_PATH      | A path to a JSON file with the redis connection config      |
| REDIS_URI | The url of the redis server, will be overwritten by REDIS_CONF_PATH      |
| MICROCDN_TEMPDI      | The temp directory path |
| MICROCDN_COMPRESSED_SIZE_LIMIT      | The size limit in bytes of the script after minification and BR compression      |
| MICROCDN_DECOMPRESSED_SIZE_LIMIT      | The size limit in bytes of the an uploaded archive after unziping      |
| MICROCDN_MINIFIED_SIZE_LIMIT      | The size limit in bytes of the script after minification      |
| MICROCDN_UPLOAD_SIZE_LIMIT      | The size limit in bytes of any uploaded content      |
| NODE_CACHING_LIMIT      | The size limit in bytes of the server side cache used when fetching scripts ( this will be multiplied by the amount of processors on the system )      |
