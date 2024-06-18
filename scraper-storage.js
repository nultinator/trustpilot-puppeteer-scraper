const puppeteer = require("puppeteer");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const csvParse = require("csv-parse");
const fs = require("fs");

const API_KEY = JSON.parse(fs.readFileSync("config.json")).api_key;

async function writeToCsv(data, outputFile) {
    if (!data || data.length === 0) {
        throw new Error("No data to write!");
    }
    const fileExists = fs.existsSync(outputFile);

    const headers = Object.keys(data[0]).map(key => ({id: key, title: key}))

    const csvWriter = createCsvWriter({
        path: outputFile,
        header: headers,
        append: fileExists
    });
    try {
        await csvWriter.writeRecords(data);
    } catch (e) {
        throw new Error("Failed to write to csv");
    }
}

async function readCsv(inputFile) {
    const results = [];
    const parser = fs.createReadStream(inputFile).pipe(csvParse.parse({
        columns: true,
        delimiter: ",",
        trim: true,
        skip_empty_lines: true
    }));

    for await (const record of parser) {
        results.push(record);
    }
    return results;
}

function range(start, end) {
    const array = [];
    for (let i=start; i<end; i++) {
        array.push(i);
    }
    return array;
}

function getScrapeOpsUrl(url, location="us") {
    const params = new URLSearchParams({
        api_key: API_KEY,
        url: url,
        country: location
    });
    return `https://proxy.scrapeops.io/v1/?${params.toString()}`;
}

async function scrapeSearchResults(browser, keyword, pageNumber, location="us", retries=3) {
    let tries = 0;
    let success = false;

    while (tries <= retries && !success) {
        
        const formattedKeyword = keyword.replace(" ", "+");
        const page = await browser.newPage();
        try {
            const url = `https://www.trustpilot.com/search?query=${formattedKeyword}&page=${pageNumber+1}`;
    
            const proxyUrl = getScrapeOpsUrl(url, location);
            await page.goto(proxyUrl);

            console.log(`Successfully fetched: ${url}`);

            const script = await page.$("script[id='__NEXT_DATA__']");

            const innerHTML = await page.evaluate(element => element.innerHTML, script);
            const jsonData = JSON.parse(innerHTML);

            const businessUnits = jsonData.props.pageProps.businessUnits;


            for (const business of businessUnits) {

                let category = "n/a";
                if ("categories" in business && business.categories.length > 0) {
                    category = business.categories[0].categoryId;
                }

                let location = "n/a";
                if ("location" in business && "country" in business.location) {
                    location = business.location.country
                }
                const trustpilotFormatted = business.contact.website.split("://")[1];

                const businessInfo = {
                    name: business.displayName.toLowerCase().replace(" ", "").replace("'", ""),
                    stars: business.stars,
                    rating: business.trustScore,
                    num_reviews: business.numberOfReviews,
                    website: business.contact.website,
                    trustpilot_url: `https://www.trustpilot.com/review/${trustpilotFormatted}`,
                    location: location,
                    category: category
                };

                await writeToCsv([businessInfo], `${keyword.replace(" ", "-")}.csv`);
            }


            success = true;
        } catch (err) {
            console.log(`Error: ${err}, tries left ${retries - tries}`);
            tries++;
        } finally {
            await page.close();
        } 
    }
}

async function startScrape(keyword, pages, location, concurrencyLimit, retries) {
    const pageList = range(0, pages);

    const browser = await puppeteer.launch()

    while (pageList.length > 0) {
        const currentBatch = pageList.splice(0, concurrencyLimit);
        const tasks = currentBatch.map(page => scrapeSearchResults(browser, keyword, page, location, retries));

        try {
            await Promise.all(tasks);
        } catch (err) {
            console.log(`Failed to process batch: ${err}`);
        }
    }

    await browser.close();
}

async function processBusiness(browser, row, location, retries = 3) {
    const url = row.trustpilot_url;
    let tries = 0;
    let success = false;

    
    while (tries <= retries && !success) {
        const page = await browser.newPage();

        try {
            await page.goto(url, location);

            const script = await page.$("script[id='__NEXT_DATA__']");
            const innerHTML = await page.evaluate(element => element.innerHTML, script);

            const jsonData = JSON.parse(innerHTML);
            const businessInfo = jsonData.props.pageProps;

            const reviews = businessInfo.reviews;

            for (const review of reviews) {
                const reviewData = {
                    name: review.consumer.displayName,
                    rating: review.rating,
                    text: review.text,
                    title: review.title,
                    date: review.dates.publishedDate
                }
                await writeToCsv([reviewData], `${row.name}.csv`);
            }

            success = true;
        } catch (err) {
            console.log(`Error: ${err}, tries left: ${retries-tries}`);
            tries++;
        } finally {
            await page.close();
        }
    } 
}

async function processResults(csvFile, location, retries) {
    const businesses = await readCsv(csvFile);
    const browser = await puppeteer.launch();

    for (const business of businesses) {
        await processBusiness(browser, business, location, retries);
    }
    await browser.close();

}

async function main() {
    const keywords = ["online bank"];
    const concurrencyLimit = 5;
    const pages = 1;
    const location = "us";
    const retries = 3;
    const aggregateFiles = [];

    for (const keyword of keywords) {
        await startScrape(keyword, pages, location, concurrencyLimit, retries);
        aggregateFiles.push(`${keyword.replace(" ", "-")}.csv`);
    }

    for (const file of aggregateFiles) {
        await processResults(file, location, concurrencyLimit, retries);
    }
}


main();