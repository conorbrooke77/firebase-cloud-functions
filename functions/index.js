const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { Storage } = require('@google-cloud/storage');
const fetch = require('node-fetch');
const storage = new Storage();
const cloudRunServiceUrl = 'https://java-pdfbox-app-l57rfkwxjq-uc.a.run.app/process-pdf';

admin.initializeApp();

// Import other functions
const { accessGutendexAPI } = require('./accessGutendexAPI');

// Export the functions
exports.accessGutendexAPI = accessGutendexAPI;

exports.processPDFOnUpload = functions.storage.object().onFinalize(async (object) => {
  
  // if (!object.contentType.includes('pdf')) {
  //   console.log('Uploaded file is not a PDF...');
  //   return;
  // }

  // Generate a signed URL for the uploaded PDF
  const signedUrlConfig = { action: 'read', expires: Date.now() + 15 * 60 * 1000 }; // URL expires in 15 minutes
  const [url] = await storage.bucket(object.bucket).file(object.name).getSignedUrl(signedUrlConfig);

  // Call the Cloud Run service with the signed URL
  const response = await fetch(cloudRunServiceUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdfUrl: url }),
  });

  if (!response.ok) {
    throw new Error(`Cloud Run service responded with ${response.status}: ${response.statusText}`);
  }

  console.log('PDF processed successfully by Cloud Run service.');
});
