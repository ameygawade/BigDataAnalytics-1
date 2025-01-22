const express = require('express');
const formidable = require('formidable');
const fs = require('fs/promises');
const app = express();
const PORT = 3000;

const Timer = require('./Timer');
const CloneDetector = require('./CloneDetector');
const CloneStorage = require('./CloneStorage');
const FileStorage = require('./FileStorage');


// Express and Formidable stuff to receice a file for further processing
// --------------------
const form = formidable({multiples:false});


app.post('/', fileReceiver );
function fileReceiver(req, res, next) {
    form.parse(req, (err, fields, files) => {
        fs.readFile(files.data.filepath, { encoding: 'utf8' })
            .then( data => { return processFile(fields.name, data); });
    });
    return res.end('');
}

app.get('/', viewClones );

const server = app.listen(PORT, () => { console.log('Listening for files on port', PORT); });


// Page generation for viewing current progress
// --------------------
function getStatistics() {
    let cloneStore = CloneStorage.getInstance();
    let fileStore = FileStorage.getInstance();
    let output = 'Processed ' + fileStore.numberOfFiles + ' files containing ' + cloneStore.numberOfClones + ' clones.'
    return output;
}

function lastFileTimersHTML() {
    if (!lastFile) return '';
    output = '<p>Timers for last file processed:</p>\n<ul>\n'
    let timers = Timer.getTimers(lastFile);
    for (t in timers) {
        output += '<li>' + t + ': ' + (timers[t] / (1000n)) + ' µs\n'
    }
    output += '</ul>\n';
    return output;
}

function listClonesHTML() {
    let cloneStore = CloneStorage.getInstance();
    let output = '';

    cloneStore.clones.forEach( clone => {
        output += '<hr>\n';
        output += '<h2>Source File: ' + clone.sourceName + '</h2>\n';
        output += '<p>Starting at line: ' + clone.sourceStart + ' , ending at line: ' + clone.sourceEnd + '</p>\n';
        output += '<ul>';
        clone.targets.forEach( target => {
            output += '<li>Found in ' + target.name + ' starting at line ' + target.startLine + '\n';            
        });
        output += '</ul>\n'
        output += '<h3>Contents:</h3>\n<pre><code>\n';
        output += clone.originalCode;
        output += '</code></pre>\n';
    });

    return output;
}

function listProcessedFilesHTML() {
    let fs = FileStorage.getInstance();
    let output = '<HR>\n<H2>Processed Files</H2>\n'
    output += fs.filenames.reduce( (out, name) => {
        out += '<li>' + name + '\n';
        return out;
    }, '<ul>\n');
    output += '</ul>\n';
    return output;
}

function viewClones(req, res, next) {
    let page='<HTML><HEAD><TITLE>CodeStream Clone Detector</TITLE></HEAD>\n';
    page += '<BODY><H1>CodeStream Clone Detector</H1>\n';
    page += '<P>' + getStatistics() + '</P>\n';
    page += lastFileTimersHTML() + '\n';
    page += listClonesHTML() + '\n';
    page += listProcessedFilesHTML() + '\n';
    page += '</BODY></HTML>';
    res.send(page);
}

// Some helper functions
// --------------------
// PASS is used to insert functions in a Promise stream and pass on all input parameters untouched.
PASS = fn => d => {
    try {
        fn(d);
        return d;
    } catch (e) {
        throw e;
    }
};

const STATS_FREQ = 100;
const URL = process.env.URL || 'http://localhost:8080/';
var lastFile = null;

function maybePrintStatistics(file, cloneDetector, cloneStore) {
    if (0 == cloneDetector.numberOfProcessedFiles % STATS_FREQ) {
        console.log('Processed', cloneDetector.numberOfProcessedFiles, 'files and found', cloneStore.numberOfClones, 'clones.');
        let timers = Timer.getTimers(file);
        let str = 'Timers for last file processed: ';
        for (t in timers) {
            str += t + ': ' + (timers[t] / (1000n)) + ' µs '
        }
        console.log(str);
        console.log('List of found clones available at', URL);
    }

    return file;
}

// Processing of the file
// --------------------
function processFile(filename, contents) {
    let cd = new CloneDetector();
    let cloneStore = CloneStorage.getInstance();
    console.log(`File: ${filename}, Contents Length: ${contents.length}`);
    if (contents.trim().length === 0) {
        console.error(`File ${filename} has empty or whitespace-only contents!`);
    } else {
        console.log(`File: ${filename} has non-empty contents.`);
    }
    return Promise.resolve({ name: filename, contents: contents })
        .then((file) => {
            console.log(`Processing File: ${file.name}`);
            return Timer.startTimer(file, 'total');
        })
        .then((file) => cd.preprocess(file))
        .then((file) => cd.transform(file))
        .then((file) => {
            // Log the number of lines after processing
            console.log(`File Processed: ${file.name}, Lines After Processing: ${file.lines.length}`);
            return file;
        })
        .then((file) => Timer.startTimer(file, 'match'))
        .then((file) => cd.matchDetect(file))
        .then((file) => cloneStore.storeClones(file))
        .then((file) => Timer.endTimer(file, 'match'))
        .then((file) => cd.storeFile(file))
        .then((file) => Timer.endTimer(file, 'total'))
        .then(PASS((file) => (lastFile = file)))
        .then(PASS((file) => maybePrintStatistics(file, cd, cloneStore)))
        .catch(console.log);
}



/*
1. Preprocessing: Remove uninteresting code, determine source and comparison units/granularities
2. Transformation: One or more extraction and/or transformation techniques are applied to the preprocessed code to obtain an intermediate representation of the code.
3. Match Detection: Transformed units (and/or metrics for those units) are compared to find similar source units.
4. Formatting: Locations of identified clones in the transformed units are mapped to the original code base by file location and line number.
5. Post-Processing and Filtering: Visualisation of clones and manual analysis to filter out false positives
6. Aggregation: Clone pairs are aggregated to form clone classes or families, in order to reduce the amount of data and facilitate analysis.
*/
function calculateMedian(arr) {
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

app.get('/timers', (req, res) => {
    const fs = FileStorage.getInstance();
    const files = [...fs.getAllFiles()];
    const timers = files.map(file => Timer.getTimers(file));
    const fileSizes = files.map(file => (file.lines || []).length);

    let totalTime = 0n, matchTime = 0n, totalLines = 0;
    const fileCount = timers.length;

    files.forEach(file => {
        const fileTimers = Timer.getTimers(file);
        totalTime += fileTimers['total'] || 0n;
        matchTime += fileTimers['match'] || 0n;
        totalLines += (file.lines || []).length;
    });

    const avgTotalTime = totalTime / BigInt(fileCount || 1);
    const avgMatchTime = matchTime / BigInt(fileCount || 1);
    const avgTimePerLine = totalTime / BigInt(totalLines || 1);

    const medianFileSize = calculateMedian(fileSizes);
    const smallFiles = fileSizes.filter(size => size < 50).length;
    const mediumFiles = fileSizes.filter(size => size >= 50 && size < 200).length;
    const largeFiles = fileSizes.filter(size => size >= 200).length;

    const page = `
        <html>
        <head><title>Timing Statistics</title></head>
        <body>
            <h1>Timing Statistics</h1>
            <p>Processed ${fileCount} files</p>
            <p>Total Lines Processed: ${totalLines}</p>
            <p>Average Total Time: ${avgTotalTime / 1000n} µs</p>
            <p>Average Match Time: ${avgMatchTime / 1000n} µs</p>
            <p>Average Time Per Line: ${avgTimePerLine / 1000n} µs</p>
            <p>Median File Size: ${medianFileSize} lines</p>
            <p>File Size Distribution:</p>
            <ul>
                <li>Small Files (<50 lines): ${smallFiles}</li>
                <li>Medium Files (50-199 lines): ${mediumFiles}</li>
                <li>Large Files (200+ lines): ${largeFiles}</li>
            </ul>
        </body>
        </html>
    `;
    res.send(page);
});

