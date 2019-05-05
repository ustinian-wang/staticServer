const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const zlib = require("zlib");
const crypto = require("crypto");

const mime = require("./mime.js");

const PORT = 8080;

const RES_DIR = path.join(__dirname, "/res");//放静态文件的目录
const WEB_DIR = path.join(__dirname, "/web");//放页面的目录

var server = http.createServer(function(request, response){

	var requestUrlObj = url.parse(request.url);
	var ext = requestUrlObj.path.split(".").reverse()[0] || '';
	var contentType=mime.getType(ext) || 'text/plain';
	if(requestUrlObj.path === "/"){
		contentType = "text/html";
	}

	console.log(ext, contentType, requestUrlObj.path);
	console.log(ext, /^css|js|jpeg|gif|jpg|gif|png&/.test(ext));



	if(requestUrlObj.path === "/favicon.ico"){//小图标请求
		response.writeHead(404, {
			'Content-Type': contentType 
		});
		response.end();
	}else if(/^css|js|jpeg|gif|jpg|gif|png$/.test(ext)){//静态资源请求
		var sourceFilePath = path.join(RES_DIR, requestUrlObj.path);

		if(fs.existsSync(sourceFilePath)){//判断文件是否存在
			//获取文件的信息
			var stats = fs.statSync(sourceFilePath);
			
			//获取文件最后被修改的时间
			response.setHeader('Last-Modified', stats.mtime.toGMTString());
			response.setHeader("Etag", genEtag(stats));

			if(isFresh(request, response)){
				response.writeHead(304);
				return response.end();
			}

			//如果开启了gzip，那么使用要使用流的方式，这样就用不了etag判断内容了，因为等拿到全部内容，响应已经发送出去了
			var readStream = fs.createReadStream(sourceFilePath);
			var compress = null;
			var acceptEncoding = request.headers["accept-encoding"];
			//开启gizp压缩
			if(acceptEncoding && acceptEncoding.includes("gzip")){
				response.setHeader("Content-Encoding", "gzip");
				compress = zlib.createGzip();//把流引入
			}else if(acceptEncoding && acceptEncoding.includes("deflate")){
				response.setHeader("Content-Encoding", "deflate");
				compress = zlib.createDeflate();//把流引入
			}else{
				return readStream.pipe(response);
			}

			readStream.pipe(compress).pipe(response);

		}else{//文件不存在
			response.write(404);
			response.end();
		}

	}else if(/^mp4$/.test(ext)){//判断过来的是什么请求

		var sourceFilePath = path.join(RES_DIR, requestUrlObj.path);
		var stats = fs.statSync(sourceFilePath);

		response.setHeader('Accept-Ranges', 'bytes');//告诉客户端，我们支持range请求
		console.log("range", request.headers["range"]);
		var range = parseRange(request.headers["range"], stats.size);
		console.log("range2", range);

		if(!range){
			response.writeHead(500);
			return response.end();
		}

		response.statusCode = (206);
		var readStream = fs.createReadStream(sourceFilePath, {start: range.start, end: range.end});
		readStream.pipe(response);

		response.setHeader("Content-Range", "bytes " + range.start + "-" + range.end + "/" + stats.size);
		response.setHeader("Content-Length", (range.end - range.start + 1));


	}else{
		var indexFilePath = path.join(WEB_DIR, "/index.html");
		console.log("ext", ext);
		promiseReadFile(indexFilePath)
		.then(function(data){
			
			response.writeHead(200, {
				'Content-Type': contentType
			});//指定报文头部

			response.write(data);//把数据塞入body
			response.end();//结束请求

		}).catch(function(err){
			console.log(err);
			response.writeHead(500);
			response.end();
		});
	}



	
	
});

server.listen(PORT);

/*做一系列的时间监听*/
// 注册时间监听
server.on("checkContinue", function(){
	/*请注意，在触发和处理此事件时，不会触发 'request' 事件。*/
	console.log("http收到 100-continue请求");
});
//每次收到带有 HTTP Expect 请求头的请求时触发
server.on("checkExceptation", function(error){
	console.log("accept http Expect", error);
});
server.on("clientError", function(error){
	console.log("客户端链接发生错误", error);
});

server.on("close", function(){
	console.log("服务器关闭");
});
server.on("connect", function(){
	//触发此事件后，请求的套接字将没有 'data' 事件监听器，
	//这意味着它需要绑定才能处理发送到该套接字上的服务器的数据。
	console.log("客户端每次请求http的connect方法时被触发");
});
server.on("request", function(){
	// console.log("每次有请求时都会触发。 注意，每个连接可能有多个请求（在 HTTP Keep-Alive 连接的情况下）。");
});
server.on("upgrade", function(){

});
// 继承自net模块的事件
server.on("connection", function(){
	console.log("一个新的链接被建立");
});
server.on("error", function(error){
	console.log("服务器发生错误，close事件后面不会被触发",error);
});
server.on("listening", function(){
	console.log(arguments);
	console.log("listening port"+PORT);
});


function promiseReadFile(filePath){
	return new Promise(function(resolve, reject){

		fs.readFile(filePath, function(err, data){
			if(err){
				reject(err);
			}else{
				resolve(data);
			}
		});

	});
}

function promiseFs_fsStat(path){
	return new Promise(function(resolve, reject){
		fs.stat(path, function(err, stats){
			if(err){
				reject(err);
			}else{
				resolve(stats);
			}
		});
	});
}

function isFresh(request, response){
	var ifNoneMatch = request.headers["if-none-match"];
	var ifModifiedSince = request.headers["if-modified-since"];
	if(!(ifNoneMatch || ifModifiedSince)){
		return false;//不支持这种验证方式，直接判断为不新鲜
	}
	//如果可以使用etag进行验证，判断是否不新鲜了
	if(ifNoneMatch && ifNoneMatch!==response.getHeader("etag")){
		return false;
	}

	if(ifModifiedSince && ifModifiedSince !== response.getHeader("last-modified")){
		return false;
	}

	return true;
}

function genEtag(stat){
    const mtime = stat.mtime.getTime().toString(16);
    const size = stat.size.toString(16);
    return `${size}-${mtime}`;
}

function parseRange(value, size){
	var range = [];
	if(value.startsWith("bytes")){
		range = value.split("bytes=")[1].split("-");
	}else{
		range = value.split("-");
	}

	var start = parseInt(range[0], 10);
	var end = parseInt(range[1], 10);
	console.log("parseRange args", value, size);
	console.log("parseRange args", start, end);
	console.log("parseRange args", value, range);
	//请求整个文件
	if(isNaN(start)){
		start = size - end;
		end = size-1;
	}else if(isNaN(end)){
		end = size - 1;
	}

	if(isNaN(start) || isNaN(end) || start>end || end>size){
		return;
	}

	return {
		start: start,
		end: end
	};
}