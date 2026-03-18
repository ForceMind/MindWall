const fs = require('fs');
const path = require('path');

function walk(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        let isDirectory = fs.statSync(dirPath).isDirectory();
        if (isDirectory) {
            if (f !== 'node_modules' && f !== '.git' && f !== 'dist' && f !== 'build' && f !== 'logs' && f !== '.vscode' && !f.startsWith('2026') && f !== 'migrations') {
                walk(dirPath, callback);
            }
        } else {
            callback(path.join(dir, f));
        }
    });
}

function replaceInFile(filePath) {
    const ext = path.extname(filePath);
    if (!['.ts', '.vue', '.html', '.md', '.json', '.sh', '.yml'].includes(ext)) return;
    
    // Ignore some files
    if (filePath.includes('package-lock.json') || filePath.includes('pnpm-lock.yaml')) return;

    let content = fs.readFileSync(filePath, 'utf8');
    let hasChanges = false;

    // Remove specific cases of "心垣"
    let newContent = content.replace(/心垣 有间/g, '有间');
    newContent = newContent.replace(/有间（心垣）/g, '有间');

    if (content !== newContent) {
        fs.writeFileSync(filePath, newContent, 'utf8');
        console.log('Updated 心垣:', filePath);
    }
}

['e:/Privy/MindWall/apps', 'e:/Privy/MindWall/docs', 'e:/Privy/MindWall/infra', 'e:/Privy/MindWall/scripts', 'e:/Privy/MindWall/README.md', 'e:/Privy/MindWall/deploy.sh'].forEach(item => {
    if (fs.existsSync(item)) {
        if (fs.statSync(item).isDirectory()) {
            walk(item, replaceInFile);
        } else {
            replaceInFile(item);
        }
    }
});