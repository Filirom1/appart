const HCCrawler = require('headless-chrome-crawler');
const fs = require('fs');
const YAML = require('yaml');
const cheerio = require('cheerio');

const mkdirp = require('mkdirp');
require('url');

(async () => {

  let confs = {}
  let confFiles = fs.readdirSync('./config')
  confFiles.forEach( (file) => {
    const confStr = fs.readFileSync(`./config/${file}`, "utf8")
    const conf = YAML.parse(confStr)
    conf.host = new URL(conf.url).host
    conf.title == (conf.title || 'title')
    confs[conf.host] = conf

    mkdirp(`./output/${conf.id}`)
  })

  const crawler = await HCCrawler.launch({
    // Function to be evaluated in browsers
    evaluatePage: (() => (
      {
        title: $('title').text(),
        body: $('body').html(),
      }
    )),
    // Function to be called with evaluated results from browsers
    onError: err => {
      console.error(err)
    },
    onSuccess: result => {
      try{

        let host = new URL(result.response.url).host
        let conf = confs[host]
        let content = null
        if(conf.contentSelector){
          let $ = cheerio.load(result.result.body)
          content = $(conf.contentSelector).html()
        }else{
          content = result.result.body
        }
        //console.log(result)
        if(content){
          //console.log(content)
          let refMatch = result.result.body.match(conf.referenceRegExp)
          console.log(result.response.url, !! refMatch)
          if(refMatch && refMatch.length > 1){
            let ref = refMatch[1].replace(/\//g, '-')
            fs.writeFileSync(`./output/${conf.id}/${ref}.html`, content)
          }
        }
        //console.log(result.links)
        result.links.forEach(async (link) => {
          if(link.match(conf.linksRegExp)){
            await crawler.queue({url: link, waitFor: conf.waitFor, waitUntil: conf.waitUntil})
          }
        })
      }catch(err) {
        console.err(err)
      }
    },
  });

  if(process.argv[2]){
    let conf = Object.values(confs).find( conf => {
      return conf.id == process.argv[2]
    })
    console.log(conf.url)
    await crawler.queue({url: conf.url, waitFor: conf.waitFor, waitUntil: conf.waitUntil});
  }else{
    Object.values(confs).forEach(async (conf) => {
      await crawler.queue({url: conf.url, waitFor: conf.waitFor, waitUntil: conf.waitUntil});
    })
  }

  await crawler.onIdle(); // Resolved when no queue is left
  await crawler.close(); // Close the crawler
})();