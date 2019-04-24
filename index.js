const fs = require('fs');
const YAML = require('yaml');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const async = require('async');
const queue = require('async/queue');
const mkdirp = require('mkdirp');
const URL = require('url');
const glob = require("glob")
const simpleGit = require('simple-git')('./');
const gmail = require('gmail-send')({
  user: process.env.GMAIL_USER || "romain.philibert@gmail.com",
  pass: process.env.GMAIL_PASSWORD,
  to:   process.env.GMAIL_TO || "romain.philibert@gmail.com",
  subject: "appart"
})

const GIT_USER=process.env.GIT_USER ||  "Filirom1"
const GIT_PASSWORD=process.env.GIT_PASSWORD

const SKIP_PERSIST = process.env.SKIP_PERSIST

let done = []
let confs = {}
let confFiles = fs.readdirSync('./config')
confFiles.forEach( (file) => {
  const confStr = fs.readFileSync(`./config/${file}`, "utf8")
  const conf = YAML.parse(confStr)
  conf.host = URL.parse(conf.url).host
  conf.title == (conf.title || 'title')
  confs[conf.host] = conf

  mkdirp.sync(`./output/${conf.id}`)
})

let files = glob.sync("./output/*/*.yml")
files.forEach( file => {
  let fileContent = fs.readFileSync(file, 'utf8')
  done.push(YAML.parse(fileContent).url)
})

let q = async.queue(analyze);

q.drain = function() {
  simpleGit.status((err, status) => {
    if(err){ throw err; }
    async.map(status.not_added, (file, cb) => {
      console.log(file)
      if (! file.match(/^output\/.*\.yml$/)){
        return cb()
      }
      fs.readFile(file, "utf8", (err, data)=>{
        if(err){
          return cb(err)
        }
        let result = YAML.parse(data)
        return cb(null, result)
      })
    }, (err, results) => {
      if(err){ throw err; }
      results = results.filter(function(el) { return el; })
      let text = YAML.stringify(results)
      if(!results || results.length == 0){
        console.log("Nothing new")
        process.exit()
      }
      console.log(text)
      if(! SKIP_PERSIST){
        simpleGit.add('./output/')
        .commit("update output")
        .removeRemote('origin')
        .addRemote('origin', `https://${GIT_USER}:${GIT_PASSWORD}@github.com/Filirom1/appart.git`)
        .push(['-u', 'origin', 'master'], () => {
          console.log('git pushed')
          gmail({
            text:    text
          }, (err, res)=>{
            if(err){ throw err; }
            console.log("email sent", res)
            process.exit()
          });
        });
      }
    })
  })
};

q.error = function(err, params) {
  console.error(params.url, err);
};

function analyze(params, cb){
  params.count = params.count || 0
  if(done.indexOf(params.url) !== -1 && ! params.index){
    console.log(`Already done for ${params.url}`)
    return cb()
  };
  if(params.count >= 2){
    console.log(`Count(${params.count}) too high for ${params.url}`)
    return cb()
  };
  delete params.index
  puppeteer.launch().then(async browser => {
    const page = await browser.newPage();
    await page.goto(params.url, { waitUntil: params.waitUntil });
    if(params.waitFor) {
      await page.waitFor(params.waitFor);
    }
    const html = await page.content();
    const title = await page.title();
    const hrefs = await page.$$eval('a', anchors => [].map.call(anchors, a => a.href));
    hrefs.forEach(href => {
      if(! href.match(new RegExp(params.linksRegExp, 'i'))){
        return
      }
      if (! href.match(/^http/)){
        return
      }

      if ( URL.parse(href).host != URL.parse(params.url).host ){
        return
      }
      href = href.replace(/\/\//, '/').replace("http:/", "http://").replace("https:/", "https://")
      if (! params.hashLinks ){
        href = href.replace(/#.*/, '')
      }
      q.push({...params, url: href, count: params.count+1})
    })

    let ref = parseRef(params, html)
    console.log(ref, params.url)

    if(ref && html.match(/(chamond|sorbier|bonnefonds|talaudi|jarez|horme)/)){
      let content = cropContent(params, html)
      let refSlug=ref.replace(/[^a-zA-Z0-9-_]/g, '')
      await fs.promises.writeFile(`./output/${params.id}/${refSlug}.html`, content)
      await fs.promises.writeFile(`./output/${params.id}/${refSlug}.yml`, YAML.stringify({url: params.url, title: title, ref: ref}))
      await page.screenshot({path: `./output/${params.id}/${refSlug}.png`, fullPage: true});
    }
    if(params.debug){
      await page.screenshot({path: `./output/${params.id}/debug.png`, fullPage: true});
      await fs.promises.writeFile(`./output/${params.id}/debug.html`, html)
    }

    await browser.close();
    done.push(params.url)
    cb(null, {html, title, hrefs})
  }).catch( err => {
    cb(err);
  });
}

function cropContent(conf, html){
  let content = null
  if(conf.contentSelector){
    let $ = cheerio.load(html)
    content = $(conf.contentSelector).html()
  }else{
    content = html
  }
  return content
}

function parseRef(conf, html){
  let refMatch = html.match(conf.referenceRegExp)
  if(refMatch && refMatch.length > 1){
    let ref = refMatch[1].replace(/\//g, '-')
    return ref
  }else{
    return null
  }
}

if(process.argv[2]){
  let conf = Object.values(confs).find( conf => {
    return conf.id == process.argv[2]
  })
  q.push({...conf, index: true})
}else{
  Object.values(confs).forEach(async (conf) => {
    q.push({...conf, index: true})
  })
}