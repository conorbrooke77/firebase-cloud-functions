const functions = require("firebase-functions");
const admin = require("firebase-admin");
const PDFParser = require("pdf2json");
const xmlbuilder = require('xmlbuilder');

admin.initializeApp();

// Import other functions
const { accessGutendexAPI } = require('./accessGutendexAPI');

// Export the functions
exports.accessGutendexAPI = accessGutendexAPI;

// Triggered when a PDF file is uploaded to Firebase Storage.
exports.parsePDFDirectToXML = functions.storage.object().onFinalize(async (object) => {
    // Check if the file is a PDF and is located in the 'pdfs/' directory.
    if (object.name.startsWith("pdfs/") && object.name.endsWith(".pdf")) {
        const bucket = admin.storage().bucket(object.bucket);
        const filePath = object.name;
        const fileName = filePath.split("/").pop();
        const tempFilePath = `/tmp/${fileName}`;

        // Download the PDF file to a temporary location.
        await downloadPDF(bucket, filePath, tempFilePath);

        // Proceed with setting up the PDF parser.
        setupPDFParser(bucket, fileName, tempFilePath, 0, 1);
    } else {
        console.log("File is not a PDF or not in the 'pdfs/' directory, skipping...");
        return;
    }
});

// Downloads the PDF file from Firebase Storage.
async function downloadPDF(bucket, filePath, tempFilePath) {
  await bucket.file(filePath).download({ destination: tempFilePath });
  console.log("PDF downloaded to temporary storage.");
}

// Sets up the PDF parser with event handlers for data ready and error events.
function setupPDFParser(bucket, fileName, tempFilePath, startPage, endPage) {

  // Initialize PDF parser and set up event handlers.
  const pdfParserJSON = new PDFParser();
  
  pdfParserJSON.on("pdfParser_dataError", (errData) =>
    console.error("PDF parsing error:", errData.parserError)
  );

  pdfParserJSON.on("pdfParser_dataReady", async (pdfData) => {
    // Process and convert each page to XML.
    if (endPage >= pdfData.Pages.length) 
        endPage = pdfData.Pages.length

    for (let pageIndex = startPage; pageIndex < endPage; pageIndex++) {
      const page = pdfData.Pages[pageIndex];
      await processPageToXML(bucket, fileName, page, pageIndex);
    }
  });
  //This is loaded first, but event handlers above must already exist before loading PDF
  pdfParserJSON.loadPDF(tempFilePath);
}

// Processes each PDF page, converting it to XML, and saving the result.
async function processPageToXML(bucket, fileName, page, pageIndex) {
    try {
      const xmlPage = createPageXML(page, pageIndex);
      const xmlString = xmlPage.end({ pretty: true });
      const xmlFileName = `${fileName.replace(".pdf", "")}_Page_${pageIndex + 1}.xml`;
      const xmlFilePath = `parsed/${xmlFileName}`;
  
      await bucket.file(xmlFilePath).save(xmlString);
      console.log(`Page ${pageIndex + 1} converted to XML and saved.`);
    } catch (error) {
      console.error("Error saving XML to Cloud Storage:", error);
    }
  }
  

// Creates XML structure for a single page of the PDF.
function createPageXML(page, pageIndex) {
  // Initialize XML structure for a page.
  const xmlPage = xmlbuilder.create("Page").att("number", pageIndex + 1);

  // Convert each text element to XML, simplifying the output.
  page.Texts.forEach((text) => {
    const decodedText = decodeURIComponent(text.R[0].T.replace(/\+/g, " "));
    xmlPage.ele(
      "Text",
      {
        font: text.R[0].TS[0],
        size: text.R[0].TS[1],
      },
      decodedText
    );
  });

  return xmlPage;
}
