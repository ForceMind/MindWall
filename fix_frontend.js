const fs = require('fs');
function replaceInFile(p) {
    let text = fs.readFileSync(p, 'utf8');
    text = text.replace(/mindwall\./g, 'youjian.');
    fs.writeFileSync(p, text, 'utf8');
}
try {
    replaceInFile('e:/Privy/MindWall/apps/web/src/lib/storage.ts');
    replaceInFile('e:/Privy/MindWall/apps/web/src/views/user/MatchListView.vue');
    console.log('done frontend');
} catch (e) {
    console.error(e);
}
