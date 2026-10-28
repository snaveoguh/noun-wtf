const http=require('http'),fs=require('fs'),path=require('path');
const [, , dir, port]=process.argv;
const T={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.glb':'model/gltf-binary','.mp3':'audio/mpeg','.onnx':'application/octet-stream','.jpg':'image/jpeg','.woff2':'font/woff2','.ttf':'font/ttf'};
http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);let f=path.join(dir,p);
if(!f.startsWith(dir)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){ if(path.extname(p)&&!p.endsWith('.html')){r.writeHead(404);return r.end();} f=path.join(dir,'index.html');}
r.writeHead(200,{'content-type':T[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);}).listen(+port,'127.0.0.1');
