const admin = require('firebase-admin');
const functions = require('firebase-functions');
const fetch = require('node-fetch');
const {Storage} = require('@google-cloud/storage');

const storage = new Storage();
const bucket = admin.storage().bucket("habit-building-reading-a-bfcfb.appspot.com");

exports.accessGutendexAPI = functions.https.onRequest(async (req, res) => {
    const gutendexUrl = "https://gutendex.com/books/"; // URL to fetch top books by downloads

    try {
        const response = await fetch(gutendexUrl);
        const data = await response.json();

        for (const book of data.results.slice(11, 15)) { // Process only the top 2 books for this example
            const {title, authors, formats} = book;
            
            const authorNames = authors.map(author => author.name).join(', ');
            const coverUrl = formats['image/jpeg']; // Fetching cover image URL
            const bookContentUrl = formats['text/plain; charset=us-ascii']; // URL for plain text content

            // Generate a filename safe for storage
            const fileName = `${title.replace(/[^a-zA-Z0-9]/g, '_')}_${authorNames.replace(/[^a-zA-Z0-9]/g, '_')}`;

            // Save the cover image
            if (coverUrl) {
                try {
                    const coverResponse = await fetch(coverUrl);
                    const coverBlob = await coverResponse.buffer();
                    const file = bucket.file(`bookImages/${fileName}.jpg`);
                    await file.save(coverBlob, { metadata: { contentType: 'image/jpeg' } });
                } catch (error) {
                    console.error('Error saving cover image to Firebase Storage:', error);
                }
            }

            // Save the book content
            if (bookContentUrl) {
                try {
                    const bookContentResponse = await fetch(bookContentUrl);
                    const bookContent = await bookContentResponse.text();
                    const bookFile = bucket.file(`books/${fileName}.txt`);
                    await bookFile.save(bookContent, { metadata: { contentType: 'text/plain' } });
                } catch (error) {
                    console.error('Error saving book content to Firebase Storage:', error);
                }
            }

            // Prepare and save metadata
            const metadata = {
                title,
                authors: authorNames,
                coverUrl,
                bookContentUrl
            };
            const metadataFile = bucket.file(`booksMeta/${fileName}.json`);
            await metadataFile.save(JSON.stringify(metadata), { metadata: { contentType: 'application/json' } });
        }

        res.send('Top books fetched and processed successfully.');
    } catch (error) {
        console.error('Error fetching or processing books:', error);
        res.status(500).send(`Error accessing Gutendex API or processing data: ${error.message}`);
    }
});

