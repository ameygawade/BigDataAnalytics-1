class FileStorage {
    static #myInstance = null;
    static getInstance() {
        FileStorage.#myInstance = FileStorage.#myInstance || new FileStorage();
        return FileStorage.#myInstance;
    }

    #myFiles = [];
    #myFileNames = [];
    #myNumberOfFiles = 0;

    constructor() {
    }

    get numberOfFiles() { return this.#myNumberOfFiles; }
    get filenames() { return this.#myFileNames; }

    isFileProcessed(fileName) {
        // return false; // FIXME: sometimes this returns true even when it shouldn't. Probably a race condition.
        return this.#myFileNames.includes(fileName);
    }

    storeFile(file) {
        if (!this.isFileProcessed(file.name)) {
            this.#myFileNames.push(file.name);
            this.#myNumberOfFiles++;
            this.#myFiles.push(file); // Replace with database insert in future
        }
        return file;
    }
    

    * getAllFiles() {
        // FUTURE Convert this to use this.#myFileNames to fetch each file from a database instead.
        // then use yield to release each file to where it is going to be used.
        for (let f of this.#myFiles) {
            yield f;
        }
    }
}

module.exports = FileStorage;
