const admin = require("firebase-admin");
const { PDFDocument } = require('pdf-lib');
const { Storage } = require('@google-cloud/storage');
const functions = require('firebase-functions');
const fs = require('fs');
const os = require('os');
const path = require('path');

admin.initializeApp();
const storage = new Storage();
const bucketName = 'habit-building-reading-a-bfcfb.appspot.com';
const bucketCloud = storage.bucket(bucketName);

// Import other functions
//const { accessGutendexAPI } = require('./accessGutendexAPI');

// Export the functions
//exports.accessGutendexAPI = accessGutendexAPI;


// The following function processes a PDF file uploaded to Firebase Storage
exports.processPdfUpload = functions.region('europe-west1').storage.object().onFinalize(async (object) => {

    //Sample PDF File Path: pdfs/Crane-Stepehn-A-Desertion-short-stories/Crane-Stepehn-A-Desertion-short-stories.pdf
    const filePath = object.name;
    const fileExtension = filePath.split('.').pop();

    // Check if the uploaded file is a PDF
    if (fileExtension.toLowerCase() !== 'pdf') {
        console.log('The file is not a PDF, ignoring:', filePath);
        return null;  // Exit if not a PDF
    }

    const userID = object.metadata.userId;
    const targetDirectory = `${userID}/pdfs/`;

    if (filePath.startsWith(targetDirectory) && filePath.endsWith('.pdf')) {
        let segmentPageCount = 0;
        if (userID) {
            segmentPageCount = await getPageCountForUser(userID)
        } else {
            console.log('No user ID specified with this file.');
        }

        // Initialize Firebase Storage
        const directoryPath = path.dirname(filePath);
        const bucket = storage.bucket(object.bucket);
        const file = bucket.file(filePath);
        let fileName = filePath.split('/').pop();
        fileName = fileName.substring(0, fileName.length - 4);
        const tempLocalFile = path.join(os.tmpdir(), filePath.split('/').pop());
        try {
            
            await file.download({destination: tempLocalFile});
            console.log(`File downloaded to ${tempLocalFile}`);

            // Check if the file starts with '%PDF-'
            const fileBuffer = fs.readFileSync(tempLocalFile);
            const fileHeader = fileBuffer.subarray(0, 5).toString();
            if (fileHeader !== '%PDF-') {
                console.error('The file does not start with %PDF-, indicating it is not a valid PDF.');
                return;
            }

            const pdfDoc = await PDFDocument.load(fileBuffer);
            const numPages = pdfDoc.getPageCount();

            if (numPages >= 250) {
                await splitPdfAndSave(6, fileName, pdfDoc, segmentPageCount, userID);
            } else if (numPages >= 100) {
                await splitPdfAndSave(4, fileName, pdfDoc, segmentPageCount, userID);
            } else {
                await splitPdfAndSave(0, fileName, pdfDoc, segmentPageCount, userID);
            }

            console.log(`Directory path: ${directoryPath}`);
            if ((segmentPageCount*5) < numPages) {
                await updateLastPageFile(bucket, directoryPath, (segmentPageCount*5));
            } else {
                await updateLastPageFile(bucket, directoryPath, -1);
            }

        } catch (error) {
            console.error('Failed to process PDF', error);
            throw new functions.https.HttpsError('internal', 'Failed to process PDF', error);
        } finally {
            // Clean up: delete the temporary file
            if (fs.existsSync(tempLocalFile)) {
                fs.unlinkSync(tempLocalFile);
                console.log('Temporary file deleted.');
            }
        }
    }
});

exports.segmentPdf = functions.region('europe-west1').https.onCall(async (data) => {

    const userId = data.userId;
    const fileData = data.fileName;

    if (!userId || !fileData) {
        throw new functions.https.HttpsError('invalid-argument', 'You must provide a fileName and userId');
    }

    console.log(`Received request from userId: ${userId} for fileName: ${fileData}`);

    let segmentPageCount = 0;
    if (userId) {
        segmentPageCount = await getPageCountForUser(userId)
    } else {
        console.log('No user ID specified with this file.');
    }

    const bucketPDFName = 'habit-building-reading-a-bfcfb.appspot.com';
    const bucketPDF = storage.bucket(bucketPDFName);
    const fileName = `${userId}/pdfs/${fileData}/${fileData}.pdf`;
    const textFilePath = `${userId}/pdfs/${fileData}`;


    console.log(`File path to pdf: ${fileName}`);
    const file = bucketPDF.file(fileName);
    const tempLocalFile = path.join(os.tmpdir(), fileName.split('/').pop());
    let lastPage = 0;
    try {
        const textFile = bucketPDF.file(`${textFilePath}/lastPage.txt`);
        const [content] = await textFile.download();
        lastPage = parseInt(content.toString().trim(), 10);

        if (lastPage === -1) {
            return null;  // Exit if pdf is finished
        } 
        
        console.log(`Last page read from file: ${lastPage}`);

    } catch (error) {
        console.error(`Failed to read from ${textFilePath}: ${error}`);
        throw new functions.https.HttpsError('unknown', `Failed to read from ${textFilePath}`, error);
    }

    try {

        await file.download({destination: tempLocalFile});
        console.log(`File downloaded to ${tempLocalFile}`);

        // Check if the file starts with '%PDF-'
        const fileBuffer = fs.readFileSync(tempLocalFile);

        const pdfDoc = await PDFDocument.load(fileBuffer);

        await splitPdfAndSave(lastPage, fileData, pdfDoc, segmentPageCount, userId);

        console.log(`Directory path: ${textFilePath}`);
        if ((lastPage + (segmentPageCount*5)) < pdfDoc.getPageCount()) {
            await updateLastPageFile(bucketPDF, textFilePath, (lastPage + segmentPageCount*5));
        } else {
            await updateLastPageFile(bucketPDF, textFilePath, -1);
        }

    } catch (error) {
        console.error('Failed to process PDF', error);
        throw new functions.https.HttpsError('internal', 'Failed to process PDF', error);
    } finally {
        // Clean up: delete the temporary file
        if (fs.existsSync(tempLocalFile)) {
            fs.unlinkSync(tempLocalFile);
            console.log('Temporary file deleted.');
        }
    }
});

async function splitPdfAndSave(startPage, fileName, pdfDoc, segmentPageCount, userID) {
    try {
        const numPages = pdfDoc.getPageCount();

        // Check if the entire PDF can be treated as one segment
        if (numPages <= segmentPageCount) {
            // Save the entire PDF as one segment without splitting
            const pdfBytes = await pdfDoc.save();
            const outputFilePath = path.join(os.tmpdir(), `${fileName}-full.pdf`);
            fs.writeFileSync(outputFilePath, pdfBytes);
            console.log(`Saved entire PDF as one segment: ${outputFilePath}`);

            // Upload the full PDF to Google Cloud Storage
            await uploadFileToGCS(outputFilePath, `${fileName}/segment 1.pdf`, userID);
            fs.unlinkSync(outputFilePath);
            return;
        }

        const maxSegments = 5;  // Maximum number of segments to create before adaption
        let currentSegment = 0;

        while (startPage < numPages && currentSegment < maxSegments) {
            const endPage = Math.min(startPage + segmentPageCount, numPages);
            const newPdfDoc = await PDFDocument.create();

            for (let i = startPage; i < endPage; i++) {
                const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [i]);
                newPdfDoc.addPage(copiedPage);
            }
            const pdfBytes = await newPdfDoc.save();

            // Save each page PDF to a new file in the temp directory
            const outputFilePath = path.join(os.tmpdir(), `page-${currentSegment + 1}.pdf`);
            fs.writeFileSync(outputFilePath, pdfBytes);
            console.log(`Saved page ${currentSegment + 1} as a separate PDF.`);

            // Upload the file to Google Cloud Storage
            await uploadFileToGCS(outputFilePath, `${fileName}/segment ${currentSegment + 1}.pdf`, userID);
            fs.unlinkSync(outputFilePath);

            // Update startPage for the next segment
            startPage += segmentPageCount;
            currentSegment++;
        }
    } catch (error) {
        console.error('Error in splitPdfAndSave:', error);
        throw error;
    }
}

async function uploadFileToGCS(filePath, destinationFileName, userID) {
    try {
        const destination = `${userID}/segments/${destinationFileName}`; // Change path as needed
        await bucketCloud.upload(filePath, {
            destination: destination,
            metadata: {
                contentType: 'application/pdf'
            }
        });
        console.log(`Uploaded ${destinationFileName} to Google Cloud Storage.`);
    } catch (error) {
        console.error(`Failed to upload ${destinationFileName} to Google Cloud Storage:`, error);
    }
}

async function updateLastPageFile(bucket, dirPath, endPage) {
    const lastPageFilePath = `${dirPath}/lastPage.txt`;
    const file = bucket.file(lastPageFilePath);

    try {
        const contentsBuffer = Buffer.from(endPage.toString());
        await file.save(contentsBuffer, { resumable: false });
    } catch (error) {
        console.error('Failed to update lastPage.txt:', error);
        throw error;
    }
}

async function getPageCountForUser(userId) {
    try {
        const dbRef = admin.database().ref(`Users/${userId}`);
        const snapshot = await dbRef.once('value');
        if (snapshot.exists()) {
            const userData = snapshot.val();
            return userData.pageCount;
        } else {
            console.log(`No data found for user ${userId}`);
            return null; // or appropriate default value
        }
    } catch (error) {
        console.error(`Error getting pageCount for user ${userId}:`, error);
        throw error;
    }
}
  