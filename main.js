"use strict";

// Modules to control application life and create native browser window
var electron = require("electron");
var p = require("path");
var os = require("os");
var fs = require("fs");
var app = electron.app;
var BrowserWindow = electron.BrowserWindow;
var Menu = electron.Menu;
var ipc = electron.ipcMain;
var loginWindow;
var isLoggedIn = false;
var cookies;
var offline = false;

var cacheDir = p.join(__dirname, "cache");
var vaultPath = p.join(cacheDir, "vault.json");
var configPath = p.join(__dirname, "config.json");

var vaultData;
var configData;


function mkdirSync(dir)
{
    try {
        fs.mkdirSync(dir);
    } catch (e) {}
}

function loadConfig()
{
    configData = loadJsonFile(configPath, {});
    
    if (!configData.engines) {
        configData.engines = [];
    }
}

function saveConfig(data)
{
    configData = data || configData;
    fs.writeFileSync(configPath, JSON.stringify(configData));
}



/*
var menuTemplate = [
    {
        label: "Window Manager",
        submenu: [
            { label: "create New" }
        ]
    },
    {
      label : "View",
            submenu : [
        { role : "reload" },
        { label : "custom reload" }
        ]
    }
];
*/

mkdirSync(cacheDir);

loadConfig();


app.on("browser-window-created",function(e,window) {
    window.setMenu(null);
});

// Keep a global reference of the window object, if you don"t, the window will
// be closed automatically when the JavaScript object is garbage collected.
var mainWindow;

/// Removes the top menu.
Menu.setApplicationMenu(null);

/*
function getJson(url, cb)
{
    var downloadWindow = new BrowserWindow({
        width: 800,
        height: 800,
        show: true, /// Use FALSE for graceful loading
        title: "Unreal Engine Launcher"
    });
    var contents = downloadWindow.webContents;
    
    downloadWindow.loadURL(url).then(function ()
    {
        console.log("LOADED");
        //console.log(contents.getAllWebContents());
        contents.savePage("/tmp/electrontest.json", "HTMLOnly").then(function ()
        {
            console.log("saved /tmp/electrontest.json");
        }).catch(function (err)
        {
            console.error(err);
        });
    });
}
*/


function getJson(url, options, cb)
{
    /// Make options optional.
    if (typeof options === "function") {
        cb = options;
        options = {};
    } else {
        options = options || {};
    }
    
    options.tmp = true;
    
    downloadURL(url, options, function ondownload(err, data)
    {
        if (!err) {
            try {
                data = JSON.parse(data);
            } catch (e) {
                return cb(true);
            }
        }
        
        cb(err, data);
    });
}

function returnFile(filePath, del, cb)
{
    var data;
    
    try {
        data = fs.readFileSync(filePath, "utf8");
    } catch (e) {
        console.error(e);
        ///TODO: Only retry so many times.
        return setTimeout(returnFile, 50, filePath, del, cb);
    }
    
    cb(false, data);
    
    if (del) {
        try {
            fs.unlink(filePath, function () {});
        } catch (e) {}
    }
}


function downloadURL(url, options, cb)
{
    var downloadWindow;
    var contents;
    var finished = false;
    
    /// Make options optional.
    if (typeof options === "function") {
        cb = options;
        options = {};
    } else {
        options = options || {};
    }
    
    if (options.login && !isLoggedIn) {
        return login(function (err, window)
        {
            if (err) {
                console.error(err);
            }
            options.window = window;
            downloadURL(url, options, cb);
        });
    }
    
    if (options.window) {
        downloadWindow = options.window;
    } else {
        downloadWindow = new BrowserWindow({show: false});
    }
    contents = downloadWindow.webContents;
    
    if (options.tmp) {
        if (!options.path) {
            /// Create a temporary filename.
            options.path = p.join(os.tmpdir(), "tmp-ue4-launcher-dl-" + Math.random() + "-" + Math.random());
        }
    }
    
    contents.session.on("will-download", function (event, item, webContents)
    {
        // Set the save path, making Electron not to prompt a save dialog.
        if (options.path) {
            item.setSavePath(options.path);
        }
    
        item.on("updated", function (event, state)
        {
            if (state === "interrupted") {
                //console.log("Download is interrupted but can be resumed")
                if (options.onInterrupt) {
                    options.onInterrupt(item);
                }
            } else if (state === "progressing") {
                if (item.isPaused()) {
                    //console.log("Download is paused")
                    if (options.onPause) {
                        options.onPause(item);
                    }
                } else {
                    //console.log(`Received bytes: ${item.getReceivedBytes()}` + " of " + item.getTotalBytes() + " " + (100 * (item.getReceivedBytes() / item.getTotalBytes())) + "%")
                    if (options.onProgress) {
                        options.onProgress(item.getReceivedBytes(), item.getTotalBytes(), item);
                    }
                }
            }
        })
        item.once("done", function (event, state)
        {
            var success = (state === "completed");
            var filePath = item.getSavePath();
            
            if (finished) {
                return;
            }
            
            finished = true;
            
            if ((options.tmp || options.returnFile) && success) {
                /// Because this may fail, it tries multiple times.
                return returnFile(filePath, options.tmp, cb);
            } else {
                cb(!success);
            }
            
            if (options.tmp) {
                try {
                    fs.unlink(filePath, function () {});
                } catch (e) {}
            }
            /*
            if (state === "completed") {
                console.log("Download successfully /tmp/test.json")
            } else {
                console.log(`Download failed: ${state}`)
            }
            */
        });
        
        if (options.onStart) {
            options.onStart(item);
        }
    });
    contents.downloadURL(url);
}



function login(cb)
{
    var contents;
    
    /// Another url
    /// https://www.unrealengine.com/id/login?redirectUrl=https%3A%2F%2Fwww.unrealengine.com%2Fmarketplace%2Fen-US%2Fstore&client_id=932e595bedb643d9ba56d3e1089a5c4b&noHostRedirect=true
    console.log("logging in")
    
    if (loginWindow) {
        try {
            loginWindow.close();
        } catch (e) {}
    }
    
    isLoggedIn = false;
    
    
    // Create the browser window.
    loginWindow = new BrowserWindow({
        width: 800,
        height: 800,
        /*
        webPreferences: {
            preload: p.join(__dirname, "preload.js")
        },
        */
        icon: p.join(__dirname, "ue-logo.png"),
        show: true, /// Use FALSE for graceful loading
        title: "Unreal Engine Launcher"
    });
    contents = loginWindow.webContents;
    
    // and load the index.html of the app.
    //loginWindow.loadFile("index.html")
    loginWindow.loadURL("https://www.unrealengine.com/login");
    /*
    loginWindow.removeMenu();
    
    loginWindow.setMenuBarVisibility(false);
    
    loginWindow.setMenu(null);
    */
    
    //let menu = Menu.buildFromTemplate([]);
    
    
    // Open the DevTools.
    // loginWindow.webContents.openDevTools()
    
    // Emitted when the window is closed.
    /*
    loginWindow.on("closed", function ()
    {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        mainWindow = null;
    });
    */
    
    /// Set the show to FALSE to use.
    /**
    loginWindow.once("ready-to-show", function ()
    {
        loginWindow.show()
    });
    */
    /*
    contents.on("will-navigate", function (e, url)
    {
        console.log("will-navigate");
        console.log(url);
        ///event.preventDefault();
    });
    contents.on("did-navigate", function (e, url, code, status)
    {
        console.log("did-navigate");
        console.log(url, code, status);
        ///event.preventDefault();
    });
    */
    function onLogin()
    {
        //contents.stop();
        console.log("Logged in");
        isLoggedIn = true;
        loginWindow.hide();
        /// We need to let it load a little longer to set cookies, it seems.
        /*
        setTimeout(function ()
        {
            //contents.stop();
            loginWindow.close();
        }, 5000);
        */
        //app.quit();
        cb(false, loginWindow);
        
    }
    contents.on("did-frame-navigate", function (e, url, code, status, isMainFrame, frameProcessId, frameRoutingId)
    {
        console.log("did-frame-navigate", url)
        if (url === "https://www.unrealengine.com/" || /^https\:\/\/www\.unrealengine\.com\/.*\/feed$/.test(url)) {
            onLogin();
        }
        //console.log("did-frame-navigate");
        //console.log(url, code, status, isMainFrame, frameProcessId, frameRoutingId);
        /// Went here after logging out.
        /// did-frame-navigate https://www.unrealengine.com/id/login?redirectUrl=https%3A%2F%2Fwww.unrealengine.com%2F&client_id=932e595bedb643d9ba56d3e1089a5c4b&noHostRedirect=true
    });
    contents.on("did-frame-finish-load", function (e, isMainFrame, frameProcessId, frameRoutingId)
    {
        console.log("did-frame-finish-load");
        if (isLoggedIn) {
            //loginWindow.close();
            ///contents.session ?
            console.log(contents.session.cookies)
            console.log("--")
            console.log(contents.session.defaultSession)
            console.log("----")
            electron.session.defaultSession.cookies.get({}).then(function onget(sessionCookies)
            {
                cookies = sessionCookies;
                console.log(cookies);
            }).catch(function onerror(err)
            {
                console.error("Error getting cookies");
                console.error(err);
            });
        }
    });
    /*
    contents.on("did-navigate-in-page", function (e, url, isMainFrame, frameProcessId, frameRoutingId)
    {
        console.log("did-frame-navigate");
        console.log(url, isMainFrame, frameProcessId, frameRoutingId);
        ///event.preventDefault();
    });
    contents.on("page-title-updated", function (e, title, explicitSet)
    {
        console.log("page-title-updated");
        console.log(title, explicitSet)
    });
    */
    contents.on("page-title-updated", function (e, title, explicitSet)
    {
        console.log("page-title-updated", title, explicitSet)
        ///TODO: Make sure it goes to the right page when logging out
        ///page-title-updated Logging out... | Epic Games true
        if (typeof title === "string" && title.indexOf("Logging out") > -1) {
            console.log("Detected logout. Trying to log in.");
            /// Redirect to the login page.
            setTimeout(function ()
            {
                loginWindow.loadURL("https://www.unrealengine.com/login");
            }, 50);
        }
    });
}

function createMainWindow()
{
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        fullscreenable: true,
        webPreferences: {
            //preload: p.join(__dirname, "preload.js")
            nodeIntegration: true,
            devTools: true,
        },
        
        icon: p.join(__dirname, "ue-logo.png"),
        show: true, /// Use FALSE for graceful loading
        title: "Unreal Engine Launcher"
    });
    var contents = mainWindow.webContents;
    // and load the index.html of the app.
    mainWindow.loadFile("pages/unreal_engine.html");
    
    mainWindow.webContents.openDevTools()
    mainWindow.maximize();
    
    mainWindow.on("close", function ()
    {
        /// Make sure everything is closed.
        if (loginWindow) {
            try {
                loginWindow.close();
            } catch (e) {}
        }
    });
}

function downloadVaultData(cb)
{
    var vault = [];
    var dlCount = 25;
    var dlTotal;
    var dlIndex = 0;
    //debugger;
    (function loop()
    {
        var url;
        
        console.log(dlIndex);
        //debugger;
        if (dlTotal !== undefined && dlIndex >= dlTotal - 1) {
            console.log("Done downloading vault");
            return cb(vault);
        }
        
        url = "https://www.unrealengine.com/marketplace/api/assets/vault?start=" + dlIndex + "&count=" + dlCount;
        
        getJson(url, {login: true}, function (err, data)
        {
            //debugger;
            console.log(data);
            if (err || !data || data.status !== "OK") {
                console.error("Cannot download vault page: " + url)
                if (data) {
                    console.error(data);
                }
                ///TODO: Try again?
            } else {
                dlTotal = data.data.paging.total;
                vault = vault.concat(data.data.elements);
                dlIndex += dlCount;
                loop();
            }
            //console.log(data);
            //fs.writeFileSync(p.join(__dirname, "test.json"), JSON.stringify(data));
        });
    }());
}

function loadJsonFile(path, defaultVal)
{
    var json;
    
    try {
        json = JSON.parse(fs.readFileSync(path, "utf8"));
    } catch (e) {
        json = defaultVal;
    }
    
    return json;
}

function getVault()
{
    if (typeof vaultData === "undefined") {
        vaultData = loadJsonFile(vaultPath, []);
    }
    
    return vaultData;
}
        
function updateVault(ignoreCache, cb)
{
    var shouldDownload;
    
    if (offline) {
        if (cb) {
            setImmediate(cb);
        }
    } else {
        shouldDownload = true;
        
        try {
            /// Only update the vault every 18 hours by default.
            if (!ignoreCache && fs.existsSync(vaultPath) && Date.now() - fs.statSync(vaultPath).mtime.valueOf() < 1000 * 60 * 60 * 18) {
                shouldDownload = false;
            }
        } catch (e) {}
        
        if (shouldDownload) {
            downloadVaultData(function (data)
            {
                if (data) {
                    vaultData = data;
                } else {
                    vaultData = [];
                }
                
                fs.writeFileSync(vaultPath, JSON.stringify(vaultData));
                
                if (cb) {
                    cb(vaultData);
                }
            });
        } else {
            setImmediate(cb);
        }
    }
}

function startup()
{
    createMainWindow();
    
    //updateVault();
    /*
    login(function ()
    {
        createMainWindow();
    });
    */
    //getJson("file:///storage/UE4Launcher/package.json");
    //downloadURL("file:///storage/UE4Launcher/package.json");
    //downloadURL("https://cdn1.epicgames.com/ue/product/Screenshot/AssetDemo-1920x1080-e2a5e4c8b0dad08bcb8d8df7495d9ab4.jpg");
    //createMainWindow();
    /*
    getJson("file:///storage/UE4Launcher/package.json", function (err, data)
    {
        console.log(err);
        console.log(data);
    });
    */
    /*
    login(function (err, loginWindow)
    {
        getJson("https://www.unrealengine.com/marketplace/api/assets/vault?start=0&count=25", {window: loginWindow}, function (err, data)
        {
            console.error(err);
            console.log(data);
        });
    });
    */
    /// Not logged in error.
    // {"status":"Error","errorCode":"errors.com.epicgames.common.authentication.authentication_failed","args":null}
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", startup);

/// Delete?
// Quit when all windows are closed.
app.on("window-all-closed", function () {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== "darwin") {
        app.quit();
    }
})

app.on("activate", function () {
    // On macOS it"s common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null) {
        createWindow();
    }
})

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.


/*
ipc.on("asynchronous-message", function (event, arg)
{
  console.log(arg) // prints "ping"
  event.reply("asynchronous-reply", "pong")
})

ipc.on("synchronous-message", function (event, arg)
{
  console.log(arg) // prints "ping"
  event.returnValue = "pong"
})
*/

function getEngineVersion(path)
{
    var data;
    var match;
    
    try {
        /// Check the last tag for the engine number.
        data = require("child_process").execSync("git describe --abbrev=0", {stdio: "pipe", cwd: path, encoding: "utf8"}).trim();
        match = data.match(/^(\d+\.\d+).*release$/);
        if (match) {
            return match[1];
        }
    } catch (e) {}
    
    try {
        /// Check BRANCH_NAME in UE4Defines.pri for the engine number.
        data = fs.readFileSync(p.join(path, "UE4Defines.pri"), "utf8");
        match = data.match(/BRANCH_NAME=".*?(\d+\.\d+)"/);
        if (match) {
            return match[1];
        }
    } catch (e) {}
}


function addEngine(path)
{
    var engineBasePath;
    var engineVersion;
    var execPath;
    
    /// Is this a link to the file?
    try {
        if (!fs.lstatSync(path).isDirectory()) {
            engineBasePath = p.join(path, "..", "..", "..", "..");
        }
        execPath = path;
    } catch (e) {}
    
    if (!engineBasePath) {
        /// Is it a link to the folder with the binary?
        try {
            if (fs.existsSync(p.join(path, "UE4Editor"))) {
                engineBasePath = p.join(path, "..", "..", "..");
            }
        } catch (e) {}
    }
    
    if (!engineBasePath) {
        /// Assume that it's the path to the root of the engine.
        engineBasePath = path;
    }
    
    engineVersion = getEngineVersion(engineBasePath);
    
    if (engineVersion) {
        if (!execPath) {
            ///TODO: Support other platforms
            execPath = p.join(engineBasePath, "Engine", "Binaries", "Linux", "UE4Editor");
        }
        configData.engines.push({
            baseDir: engineBasePath,
            version: engineVersion,
            execPath: execPath,
        });
        saveConfig();
    }
}

ipc.on("getVault", function (e/*, arg*/)
{
    console.log("getting vault");
    
    e.returnValue = JSON.stringify(getVault());
});

ipc.on("updateVault", function (e, ignoreCache)
{
    console.log("updating vault");
    
    updateVault(ignoreCache, function (data)
    {
        e.reply("updateVault", data ? JSON.stringify(data) : "");
    });
});

ipc.on("getConfig", function (e, arg)
{
    e.returnValue = JSON.stringify(configData);
});
/*
ipc.on("saveConfig", function (e, arg)
{
    e.returnValue = JSON.stringify(getVault());
});
*/

ipc.on("addEngine", function (e, path)
{
    /// Make sure it does not freeze.
    try {
        addEngine(path);
    } catch (e) {
        console.error(e);
    }
    /// If you do not set this, it will hang.
    e.returnValue = "";
});

