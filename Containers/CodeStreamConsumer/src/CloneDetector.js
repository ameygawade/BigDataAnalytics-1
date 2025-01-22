const emptyLine = /^\s*$/; // Matches only empty or whitespace-only lines
const oneLineComment = /\/\/.*$/; // Matches single-line comments starting with //
const openMultiLineComment = /\/\*.*$/; // Matches the start of multi-line comments (/*)
const closeMultiLineComment = /^.*\*\//; // Matches the end of multi-line comments (*/)
const oneLineMultiLineComment = /\/\*.*\*\//; // Matches single-line multi-line comments (/* ... */)



const SourceLine = require('./SourceLine');
const FileStorage = require('./FileStorage');
const Clone = require('./Clone');

const DEFAULT_CHUNKSIZE=5;

class CloneDetector {
    #myChunkSize = process.env.CHUNKSIZE || DEFAULT_CHUNKSIZE;
    #myFileStore = FileStorage.getInstance();

    constructor() {
    }

    // Private Methods
    // --------------------
    #filterLines(file) {
        let lines = file.contents.split('\n');
        let inMultiLineComment = false;
        file.lines = []; // Initialize lines array
    
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
    
            if (inMultiLineComment) {
                if (line.search(closeMultiLineComment) !== -1) {
                    line = line.replace(closeMultiLineComment, '');
                    inMultiLineComment = false;
                } else {
                    continue; // Skip the line inside multi-line comments
                }
            }
    
            line = line.replace(oneLineComment, ''); // Remove single-line comments
            line = line.replace(oneLineMultiLineComment, ''); // Remove one-line multi-line comments
    
            if (line.search(openMultiLineComment) !== -1) {
                line = line.replace(openMultiLineComment, '');
                inMultiLineComment = true;
            }
    
            if (!line.match(emptyLine)) {
                file.lines.push(new SourceLine(i + 1, line.trim()));
            }
        }
    
        console.log(`File: ${file.name}, Lines After Filtering: ${file.lines.length}`);
        return file;
    }
    
    

    #getContentLines(file) {
        return file.lines.filter( line => line.hasContent() );        
    }


    #chunkify(file) {
        let chunkSize = this.#myChunkSize;
        let lines = this.#getContentLines(file);
        file.chunks=[];

        for (let i = 0; i <= lines.length-chunkSize; i++) {
            let chunk = lines.slice(i, i+chunkSize);
            file.chunks.push(chunk);
        }
        return file;
    }
    #chunkMatch(first, second) {
        const crypto = require('crypto');
    
        const hash = (chunk) =>
            crypto.createHash('sha256')
                  .update(chunk.map(line => line.content).join('\n'))
                  .digest('hex');
    
        return hash(first) === hash(second);
    }
    
    
    

    #filterCloneCandidates(file, compareFile) {
        // Ensure instances array is initialized
        file.instances = file.instances || [];
    
        // Loop through file chunks and compare with compareFile chunks
        const matchingClones = file.chunks.flatMap((fileChunk, fileIndex) => {
            return compareFile.chunks
                .filter(compareChunk => this.#chunkMatch(fileChunk, compareChunk)) // Match chunks
                .map(compareChunk => new Clone(file.name, compareFile.name, fileChunk, compareChunk)); // Create Clones
        });
    
        // Append new clones to instances
        file.instances = file.instances.concat(matchingClones);
        return file;
    }
    
     
    #expandCloneCandidates(file) {
        file.instances = file.instances.reduce((expandedInstances, currentClone) => {
            // Check if the current clone can expand any existing clone
            const existingClone = expandedInstances.find(existing => existing.maybeExpandWith(currentClone));
            if (!existingClone) {
                // If no existing clone can expand, add this as a new entry
                expandedInstances.push(currentClone);
            }
            return expandedInstances;
        }, []);
    
        return file;
    }
    
    
    #consolidateClones(file) {
        file.instances = file.instances.reduce((accumulator, currentClone) => {
            // Find existing clones matching the current clone
            let existingClone = accumulator.find(clone => clone.equals(currentClone));
            if (existingClone) {
                // Merge targets if already existing
                existingClone.addTarget(currentClone);
            } else {
                // Otherwise, add as a new clone
                accumulator.push(currentClone);
            }
            return accumulator;
        }, []);
    
        return file;
    }
    
    

    // Public Processing Steps
    // --------------------
    preprocess(file) {
        return new Promise((resolve, reject) => {
            console.log(`Preprocessing file: ${file.name}`);
            if (!file.name.endsWith('.java')) {
                console.log(`${file.name} is not a Java file.`);
                resolve(file); // Allow all files for debugging
            } else if (this.#myFileStore.isFileProcessed(file.name)) {
                console.log(`${file.name} has already been processed.`);
                reject(file.name + ' has already been processed.');
            } else {
                resolve(file);
            }
        });
    }

    transform(file) {
        file = this.#filterLines(file);
        file = this.#chunkify(file);
        return file;
    }

    matchDetect(file) {
        let allFiles = this.#myFileStore.getAllFiles();
        file.instances = file.instances || [];
        for (let f of allFiles) {
            // TODO implement these methods (or re-write the function matchDetect() to your own liking)
            // 
            // Overall process:
            // 
            // 1. Find all equal chunks in file and f. Represent each matching pair as a Clone.
            //
            // 2. For each Clone with endLine=x, merge it with Clone with endLine-1=x
            //    remove the now redundant clone, rinse & repeat.
            //    note that you may end up with several "root" Clones for each processed file f
            //    if there are more than one clone between the file f and the current
            //
            // 3. If the same clone is found in several places, consolidate them into one Clone.
            //
            file = this.#filterCloneCandidates(file, f); 
            file = this.#expandCloneCandidates(file);
            file = this.#consolidateClones(file); 
        }

        return file;
    }

    pruneFile(file) {
        delete file.lines;
        delete file.instances;
        return file;
    }
    
    storeFile(file) {
        this.#myFileStore.storeFile(this.pruneFile(file));
        return file;
    }

    get numberOfProcessedFiles() { return this.#myFileStore.numberOfFiles; }
}

module.exports = CloneDetector;
