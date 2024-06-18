const puppeteer = require("puppeteer");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const csvParse = require("csv-parse");
const fs = require("fs");

const API_KEY = JSON.parse(fs.readFileSync("config.json")).api_key;

function range(start, end) {
    const array = [];
    for (let i=start; i<end; i++) {
        array.push(i);
    }
    return array;
}


async function scrapeSearchResults(browser, keyword, pageNumber, location="us", retries=3) {
    let tries = 0;
    let success = false;

    while (tries <= retries && !success) {
        
        const formattedKeyword = keyword.replace(" ", "+");
        const page = await browser.newPage();
        try {
            const url = `https://www.trustpilot.com/search?query=${formattedKeyword}&page=${pageNumber+1}`;
    
            await page.goto(url);

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

                console.log(businessInfo);
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

async function startScrape(keyword, pages, location, retries) {
    const pageList = range(0, pages);

    const browser = await puppeteer.launch()

    for (const page of pageList) {
        await scrapeSearchResults(browser, keyword, page, location, retries);
    }

    await browser.close();
}


async function main() {
    const keywords = ["online bank"];
    const concurrencyLimit = 5;
    const pages = 1;
    const location = "us";
    const retries = 3;

    for (const keyword of keywords) {
        await startScrape(keyword, pages, location, concurrencyLimit, retries);
    }

}


main();