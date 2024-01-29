import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as pdfParse from "pdf-parse";

admin.initializeApp();

// Function to handle HTTP requests (e.g., API calls)
export const handleHttpRequest = onRequest(async (req, res) => {
  logger.info("Handling HTTP request...");

  try {
    // HTTP request handling logic goes here
    res.status(200).send("Hello, BookByte!");
  } catch (error) {
    logger.error("Error handling HTTP request:", error);
    res.status(500).send("Internal Server Error");
  }
});

/**
 * Checks if the given content type indicates a PDF file.
 * @param {Object} contentType - The content type to check.
 * @return {any} True if the content type indicates a PDF; otherwise, false.
 */
function isContentTypePDF(contentType: string | undefined): boolean {
  return !!contentType && contentType.startsWith("application/pdf");
}

/**
 * Checks if the given file path has a valid PDF extension.
 * @param {Object} filePath - The file path to check.
 * @return {any} True if the file path has a valid extension; else, false.
 */
function isValidPDFFilePath(filePath: string): boolean {
  const validExtensions = [".pdf"]; // Add more valid extensions if needed

  // Extract the file extension from the file path
  const fileExtension = path.extname(filePath).toLowerCase();

  // Check if the file extension is in the list of valid PDF extensions
  return validExtensions.includes(fileExtension);
}

/**
 * Downloads a file from Firebase Storage to a temporary location on the server.
 * @param {Object} fileBucket - The storage bucket containing the file.
 * @param {Object} filePath - The path of the file within the storage bucket.
 * @return {any} The path to the temporary file on the server.
 */
async function downloadFileToTempLocation(
  fileBucket: string,
  filePath: string
): Promise<string> {
  const bucket = admin.storage().bucket(fileBucket);
  const pdfFile = bucket.file(filePath);

  // Create a temporary file path on the server
  const tempFilePath = path.join(os.tmpdir(), path.basename(filePath));

  // Download the PDF file to the temporary file path
  await pdfFile.download({ destination: tempFilePath });

  return tempFilePath;
}

/**
 * Segments a PDF file using pdf-parse library.
 * @param {Object} filePath - The path to the PDF file on the server.
 * @return {any} The parsed text content as a string.
 */
async function segmentPDFFile(filePath: string): Promise<string> {
  try {
    // Read the PDF file into a buffer
    const dataBuffer = fs.readFileSync(filePath);

    // Parse the PDF data
    const pdfData = await pdfParse(dataBuffer);

    // Access the text content from the parsed PDF data
    const parsedText = pdfData.text;

    // Your segmentation logic here (if needed)...

    return parsedText;
  } catch (error) {
    console.error("Error parsing PDF:", error);
    throw error;
  }
}

// /**
//  * Stores segmented data in Firestore.
//  * @param segmentedData - The data to be stored.
//  */
// async function sendSegmentedDataToFirestore(
//   segmentedData: any
// ): Promise<void> {
//   await admin.firestore().collection("segments").add(segmentedData);
// }

// Function to segment a PDF file when uploaded to Firebase Storage
export const segmentPDF = functions.storage
  .object()
  .onFinalize(async (object) => {
    try {
      logger.info("Segmenting PDF...");

      const fileBucket = object.bucket;
      const filePath = object.name;
      const contentType = object.contentType;

      // Check if contentType indicates a PDF file
      if (!isContentTypePDF(contentType)) {
        logger.info("This is not a PDF file.");
        return null;
      }

      // Check if filePath is defined
      if (!filePath) {
        logger.error("File path is undefined.");
        return null;
      }

      // Check if the file path has a valid PDF extension
      if (!isValidPDFFilePath(filePath)) {
        logger.info("Invalid PDF file path.");
        return null;
      }

      // Download the PDF file to a temporary location
      const tempFilePath = await downloadFileToTempLocation(
        fileBucket,
        filePath
      );

      // Segment the PDF file
      const segmentedText = await segmentPDFFile(tempFilePath);

      // Log the parsed text
      logger.info("Parsed Text:", segmentedText);

      // Using Realtime Database to send the parsed text to Android Studios

      // Define the path in the Realtime Database to store the segmented text
      const databasePath = "/segmentedText"; // Replace with your desired path

      // Get a reference to the specified path in the Realtime Database
      const databaseRef = admin.database().ref(databasePath);

      // Set the segmented text in the Realtime Database
      await databaseRef.set(segmentedText);

      // Logging that the PDF segmentation was successful
      logger.info("PDF segmented successfully.");

      // Return null to indicate successful execution
      return null;
    } catch (error) {
      // Logging and returning if an error occurs during PDF segmentation
      logger.error("Error segmenting PDF:", error);
      return null;
    }
  });
