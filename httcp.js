var port = process.argv[2];

var net = require("net");

var staticRoutes = {};


function respondHtml(response, body){
 response.setHeader("Content-Type", "text/html")
 response.end(body);
}

function dictToAlist(dict){
 return Object.keys(dict).map(
  function(k){
   return [k, dict[k]];
  }
 );
}

function escapeAttr(kv){
 var k = kv[0];
 var v = kv[1]; // TODO: escape
 return k + "=\"" + v + "\"";
}

function htmlSingleton(tag, attrs){
 var attributes = dictToAlist(attrs).map(escapeAttr);
 return "<" + tag +
  (attributes.length ? (" " + attributes.join(" ")) : "") +
  " />";
}

function htmlWrapMultiline(tag, attrs, body){
 var attributes = dictToAlist(attrs).map(escapeAttr);
 var open = "<" + tag +
  (attributes.length ? (" " + attributes.join(" ")) : "") +
  ">";
 var lines = body.split("\n");
 var close = "</" + tag + ">";
 return open + "\n " + lines.join("\n ") + "\n" + close;
}

function htmlSimpleLines(tag, lines){
 return htmlWrapMultiline(tag, {}, lines.join("\n"));
}

function respondHtmlSimpleBody(response, title, bodyLines){
 return respondHtml(
  response,
  htmlSimpleLines(
   "html",
   [
    htmlSimpleLines("head", [htmlSimpleLines("title", [title])]),
    htmlSimpleLines("body", bodyLines),
   ]
  ) + "\n"
 );
}

function simpleUl(items){
 return htmlSimpleLines(
  "ul",
  items.map(
   function(item){
    return htmlSimpleLines("li", [item]);
   }
  )
 );
}

function simpleAnchor(url, body){
 return htmlWrapMultiline("a", {href: url}, body);
}

function statefulHtmlResource(titleMaker, bodyMaker){
 function result(request, response){
  return respondHtmlSimpleBody(
   response,
   titleMaker(request),
   bodyMaker(request)
  );
 }
 result.title = titleMaker();
 result.name = result.title;
 return result;
}

function K(value){
 return function konstant(){
  return value;
 }
}

function readPostFormdata(handleField, formEnd){
 return function POST(request, response){
  var contentType = "application/x-www-form-urlencoded";
  var content_type = request.headers["content-type"].split(";")[0];
  if(
   content_type.toLowerCase() != contentType.toLowerCase()
  ){
   console.log("got content type", request.headers["content-type"]);
   return response.end("expected content type " + contentType); // TODO
  }
  var chunks = [];
  request.on(
   "data",
   function(chunk){
    if(1 != chunks.join("").split("&").length)
	console.log("delimiter", chunks); // TODO
    chunks.push(chunk);
   }
  );
  request.on(
   "end",
   function(){
    handleField(chunks.join(""));
    formEnd(response);
   }
  );
 }
}

function formResource(title, fields, formback){
 function GET(q, s){
  var form = htmlWrapMultiline(
   "form",
   {method: "POST"},
   [].concat(
    fields.map(
     function(kv){
      var name = kv[0];
      var type = kv[1];
      return htmlSingleton("input", {type: type, name: name});
     }
    ),
    [
     htmlSingleton("input", {type: "submit"})
    ]
   ).join("\n")
  );
  return respondHtmlSimpleBody(s, "New Server", [form]);
  return s.end("not ready");
 }
 function result(q, s){
  var postfields = {};
  function handleField(attr){
   var tokens = attr.split("=");
   var field = tokens.shift();
   var value = tokens.join("=");
   postfields[field] = value;
  }
  function handleForm(formdata, response){
   var args = fields.map(
    function(kv){
     return postfields[kv[0]];
    }
   );
   var url = formback.apply(this, args);
   var resource = staticRoutes[url];
   var title = resource.name;
   if("title" in resource) title = resource.title;
   respondHtmlSimpleBody(
    response,
    title,
    [simpleAnchor(url, title)]
   );
  }
  function formEnd(response){
   handleForm(postfields, response);
  }
  var methods = {GET: GET, POST: readPostFormdata(handleField, formEnd)};
  var method = q.method.toUpperCase();
  if(method in methods) return methods[method](q, s);
  return s.end("bad method"); // TODO: error code
 }
 result.title = title;
 return result;
}

function statelessHtmlResource(title, body){
 return statefulHtmlResource(K(title), K(body));
}

staticRoutes["/"] = statefulHtmlResource(
 K("TCP over HTTP"),
 function index(request){
  return [
   simpleUl(
    dictToAlist(staticRoutes).map(
     function(kv){
      var path = kv[0];
      var resource = kv[1];
      var name = resource.name;
      if("title" in resource) name = resource.title;
      return simpleAnchor(path, name);
     }
    )
   )
  ];
 }
);

function ServerResource(port){
 this.port = +port;
 this.connections = [];
 this.i = servers.length;
 servers[this.i] = this;
 this.server = net.createServer(this.addConnection.bind(this));
 this.url = "/server/" + this.i;
 this.listening = false;
 this.dead = false;
 this.registerPending();
 var that = this;
 this.server.on(
  "error",
  function(error){
   that.registerFailed(error);
   servers[that.i] = null;
   that.dead = true;
  }
 );
 this.server.listen(
  this.port,
  function(){
   that.registerListening();
   that.listening = true;
  }
 );
}
ServerResource.Socket = function Socket(sock, server){
 this.server = server;
 this.sock = sock;
 this.done = false;
 this.chunks = [];
 this.i = this.server.connections.length;
 this.server.connections[this.i] = this;
 sock.on("data", [].push.bind(this.chunks));
 var that = this;
 sock.on("end", function(){that.done = true;});
 this.url = this.server.url + "/" + this.i;
 staticRoutes[this.url + "/read"] = this.GET.bind(this);
 staticRoutes[this.url + "/read"].title = "read " + this.title();
 staticRoutes[this.url] = formResource(
  "respond to " + this.title(),
  [["hex", "text"]],
  this.appendHex.bind(this)
 );
};
ServerResource.prototype.registerPending = function registerPending(){
 staticRoutes[this.url] = statelessHtmlResource(
  "server " + this.i + " pending",
  [
   "server number " + this.i +
    " is attempting to listen on port " + this.port
  ]
 );
};
ServerResource.prototype.registerFailed = function registerFailed(error){
 staticRoutes[this.url] = statelessHtmlResource(
  "server " + this.i + " error",
  [
   "server number " + this.i,
   "listening on port " + this.port,
   "failed because " + error.code
  ]
 );
};
ServerResource.prototype.registerListening = function registerListening(){
 var that = this;
 staticRoutes[this.url] = statelessHtmlResource(
  "server " + this.i,
  [
   "server number " + this.i,
   "listening on port " + this.port,
   {
    toString: function toString(){
     return simpleUl(that.connections);
    }
   }
  ]
 );
};
ServerResource.prototype.Socket = ServerResource.Socket;
ServerResource.prototype.addConnection = function addConnection(sock){
 return new (this.Socket)(sock, this);
};
ServerResource.Socket.prototype.toString = function toString(){
 return simpleAnchor(
  this.url,
  this.title()
 );
};
ServerResource.Socket.prototype.title = function title(){
 return "server " + this.server.i + " connection " + this.i;
}
ServerResource.Socket.prototype.GET = function GET(request, response){
 response.setHeader("Content-Type", "application/octet-stream");
 response.end(this.chunks.join(""));
}
ServerResource.Socket.prototype.appendHex = function appendHex(hex){
 try{
  this.sock.write(hex, "hex");
 }
 catch(e){
console.log(e);
  return "/";
 }
 return this.url;
};
var servers = [];
staticRoutes["/server/new/"] = formResource(
 "New Server",
 [["port", "number"]],
 function formback(port){
  return new ServerResource(port).url;
 }
);

var indexjs = "/index.js";

staticRoutes[indexjs] = function js(request, response){
 response.setHeader("Content-Type", "application/javascript");
 response.end(
  [
   K,
   function promisePost(url, data){
    return new Promise(
     function(res, rej){
      return $.post(url, data, res);
     }
    );
   },
   function promiseGet(url){
    return new Promise(
     function(res, rej){
      return $.get(url, res);
     }
    );
   },
   function htmlToDescendants(html){
    return $($.parseHTML(html)).find("*").addBack();
   },
   function promiseMakeServer(port){
    return promisePost(
     "/server/new/",
     {port: port}
    ).then(htmlToDescendants).then(
     function(docscend){
      var serverIds = [].slice.call(
       docscend.filter("a[href^=\"/server/\"]")
      ).map(
       function(a){
        return a.href;
       }
      ).map(
       function(href){
        var parts = href.split("/");
        while(parts.length)
         if("server" == parts.shift())
          return parts.shift();
       }
      );
      return +serverIds.filter(
       function(x){
        if("" + x != "" + +x) return false;
        if(x) return x;
        return 0 === x;
       }
      )[0];
     }
    );
   },
   function promiseGetConnections(server){
    return promiseGet("/server/" + +server).then(htmlToDescendants).then(
     function(docscendants){
      var anchors = $(docscendants).filter(
       "ul li a[href^=\"/server/" + +server + "\"]"
      );
      var hrefs = [].slice.call(anchors).map(function(a){return a.href;});
      return connections = hrefs.map(
       function(href){
        var parts = href.split("/");
        while(parts.length)
         if("server" == parts.shift())
          if("" + +server == "" + parts[0])
           return parts[1];
       }
      ).filter(
       function(x){
        if("" + x != "" + +x) return false;
        if(x) return x;
        return 0 === x;
       }
      ).map(function(x){return +x;});
     }
    );
   },
   function promiseReadConnection(server, connection){
    return promiseGet("/server/" + +server + "/" + +connection + "/read");
   },
   function promiseAppendResponseText(server, connection, text){
    var hex = [].slice.call(text).map(
     function(c){
      var h = "00" + c.charCodeAt(0).toString(16);
      return h.substr(h.length - 2, 2);
     }
    ).join("");
    var url = ["", "server", +server, +connection].join("/")
    return promisePost(url, {hex: hex});
   },
   function Socket(server, i){
    this.server = server;
    this.i = i;
    this.promiseRead = function promiseRead(){
     return this.server.promiseReadConnection(this.i);
    };
    this.promiseWriteText = function promiseWrite(text){
     return this.server.promiseWriteText(this.i, text);
    };
   },
   function promiseAll(xs){
    return Promise.all([].slice.call(xs).map(Promise.resolve.bind(Promise)));
   },
   function Server(port){
    this.port = +port;
    this.promise = promiseMakeServer(this.port);
    var that = this;
    this.promise.then(
     function(i){
      that.i = i;
     }
    );
    this.promiseConnections = function promiseConnections(){
     return that.promise.then(
      function(i){
       return promiseGetConnections(i);
      }
     ).then(
      function(connections){
       var server = that;
       return promiseAll(
        connections.map(
         function(connection){
          return new Socket(server, connection);
         }
        )
       );
      }
     );
    };
    this.promiseReadConnection = function promiseRead(connection){
     return this.promise.then(
      function(server){
       return promiseReadConnection(server, connection);
      }
     );
    };
    this.promiseWriteText = function(connection, text){
     return this.promise.then(
      function(server){
       promiseAppendResponseText(server, connection, text);
      }
     );
    };
   },
   function alistToDict(pairs){
    var result = {};
    pairs.reverse().map(
     function(kv){
      result[kv[0]] = kv[1];
     }
    );
    return result;
   },
   dictToAlist,
   function lowercaseDict(d){
    return alistToDict(
     dictToAlist(d).map(
      function(kv){
       return [kv[0].toLowerCase(), kv[1]];
      }
     )
    );
   },
   function caseInsensitiveAlistLack(key, alist){
    return !(key.toLowerCase() in lowercaseDict(alistToDict(alist)));
   },
   function HttpRequest(sock){
    this.done = false;
    this.sock = sock;
    this.promiseParseRequest = function promiseParseRequest(){
     return this.sock.promiseRead().then(
      function(request){
       var lines = request.split("\r\n");
       var requestLine = lines.shift();
       var mqv = requestLine.split(" ");
       var headerLines = [];
       while(lines.length && lines[0].trim().length)
        headerLines.push(lines.shift());
       return {
        method: mqv[0],
        query: mqv[1],
        version: mqv[2].split("/")[1].split("."),
        headers: headerLines.map(function(line){return line.split(": ");}),
        body: lines.slice(1).join("\r\n")
       };
      }
     );
    };
    this.promiseRespond = function promiseRespond(status, headers, body){
     var contentLength = body.length;
     var responseHeaders = [].slice.call(headers);
     if(caseInsensitiveAlistLack("Content-Length", responseHeaders))
      responseHeaders.push(["Content-Length", contentLength]);
     if(caseInsensitiveAlistLack("Connection", responseHeaders))
      responseHeaders.push(["Connection", "close"]);
     var response = "HTTP/1.1 " + status + "\r\n" +
      responseHeaders.map(
       function(kv){
        return kv.join(": ");
       }
      ).join("\r\n") +
      "\r\n\r\n" + body + "\r\n";
      var that = this;
      return sock.promiseWriteText(response).then(
       function(){that.done = true;}
      );
    };
   },
   function Webserver(port, responder){
    this.server = new Server(port);
    this.requests = [];
    this.promiseAcceptRequests = function acceptRequests(){
     var that = this;
     return this.server.promiseConnections().then(
      function(connections){
       return connections.slice(that.requests.length).map(
        function(sock){
         var req = new HttpRequest(sock);
         that.requests.push(req);
         return req;
        }
       );
      }
     );
    };
    this.promiseRespond = function promiseRespond(){
     return promiseAll(
      this.requests.filter(function(req){return !req.done;}).map(
       function(req){
        return Promise.resolve(
         responder.call(responder, req.promiseParseRequest())
        ).then(
         function(response){
          return req.promiseRespond(
           response.status,
           response.headers,
           response.body
          );
         }
        );
       }
      )
     );
    };
    this.listenForever = function listenForever(timeout){
     if(!arguments.length) timeout = 500;
     return this.promiseAcceptRequests().then(
      this.promiseRespond.bind(this)
     ).then(
      function(){
       return new Promise(
        function(res, rej){
         setTimeout(res, timeout);
        }
       );
      }
     ).then(this.listenForever.bind(this));
    };
   },
   function UrlRouter(){
    this.routes = {};
    this.call = function(that, reqProm){
     return Promise.resolve(reqProm).then(
      function(request){
       if(request.query in that.routes)
        return Promise.resolve(that.routes[request.query]).then(
         function(route){
          return route.call(route, request);
         }
        ).then(
         function(response){
          return [response.status, response.headers, response.body];
         }
        );
       var status = 404;
       var headers = [];
       var body = "not found";
       return [status, headers, body];
      }
     ).then(promiseAll).then(
      function(shb){
       return {status: shb[0], headers: shb[1], body: shb[2]};
      }
     );
    };
   },
   function Form(title, fields, poster){
    this.title = title;
    this.fields = fields;
    this.poster = poster;
    this.GET = function(request){
     var fields = this.fields.map(
      function(kv){
       return "<input type=\"" + kv[1] + "\" name=\"" + kv[0] + "\"></input>";
      }
     );
     var body = "<html><body><form method=\"POST\">" + fields.join("\n") +
      "<input type=\"submit\"></input></form></body></html>";
     return {status: 200, headers: [["Content-Type", "text/html"]], body: body};
    };
    this.POST = function(request){
     return this.poster.call(
      this.poster,
      alistToDict(
       request.body.split("&").map(
        function(kv){
         var parts = kv.split("=");
         var k = parts.shift();
         return [k, parts.join("=")];
        }
       )
      )
     );
    };
    this.call = function(that, request){
     if("GET".toLowerCase() == request.method.toLowerCase())
      return that.GET(request);
     if("POST".toLowerCase() == request.method.toLowerCase())
      return that.POST(request);
     return {status: 200, headers: [], body: "bad method"}; // TODO
    };
   },
   function YoDawg(port){
    // I heard you liked TCP over HTTP.
    // So I wrote an HTTP server for managing TCP servers
    //  and implemented it as a client for the HTTP TCP server.
    this.router = new UrlRouter();
    this.server = new Webserver(port, this.router);
    this.servers = [];
    // TODO: all of the resources created in the server
    var that = this;
    this.router.routes["/"] = function index(request){
     var items = dictToAlist(that.router.routes);
     var body = "<html><body><ul>\n" +
      items.map(
       function(kv){
        var name = kv[1].name;
        if("title" in kv[1]) name = kv[1].title;
        return "<li><a href=\"" + kv[0] + "\">" + name + "</a></li>";
       }
      ).join("\n") +
      "\n</ul></body></html>";
     return {status: 200, headers: [["Content-Type", "text/html"]], body: body};
    };
    this.router.routes["/server/new/"] = new Form(
     "make a new server",
     [["port", "number"]],
     function(formdata){
      var port = +formdata.port;
      var i = that.servers.length;
      var url = "/server/" + i;
      var server = new Server(port);
      that.servers[i] = server;
      server.downstream_index = i;
      that.router.routes[url] = function serve(request){
       return server.promiseConnections().then(
        function(connections){
         var body = "<html><body><ul>" + connections.map(
          function(sock){
           var surl = url + "/" + sock.i;
           that.router.routes[surl] = new Form(
            "write to " + i +  "." + sock.i,
            [["hex", "text"]],
            function write(formdata){
             var hex = formdata.hex;
             function sliceEvery(xs, n){
              var result = [];
              for(var i = 0; i < xs.length; i += n)
               result.push(xs.slice(i, i+n));
              return result;
             }
             return sock.promiseWriteText(
              sliceEvery([].slice.call(hex), 2).map(
               function(hexits){
                return parseInt(hexits.join(""), 16)
               }
              ).map(
               function(c){
                return String.fromCharCode(c);
               }
              ).join("")
             ).then(
              K(
               {
                status: 200,
                headers: [["Content-Type", "text/html"]],
                body: "<html><body>" +
                 "<a href=\"" + surl + "\">another</a></body></html>"
               }
              )
             );
            }
           );
           that.router.routes[surl + "/read"] = function read(request){
            return sock.promiseRead().then(
             function(body){
              return {
               status: 200,
               headers: [["Content-Type", "application/octet-stream"]],
               body: body
	      };
             }
            );
           };
           return "<li><a href=\"" + surl + "\">connection " +
            sock.i + "</a></li>";
          }
         ).join("\n") + "</ul></body></html>";
         return {
          status: 200,
          headers: [["Content-Type", "text/html"]],
          body: body
         };
        }
       );
      };
      var body = "<html><body>" +
       "<a href=\"" + url + "\">server " + i + "</a>" +
       "</body></html>";
      return {status: 200, headers: [["Content-Type","text/html"]], body: body};
     }
    );
    var indexjs = "/index.js";
    this.router.routes[indexjs] = function jsapi(request){
     return {
      status: 200,
      headers: [["Content-Type", "application/javascript"]],
      body: [
       K,
       promisePost,
       promiseGet,
       htmlToDescendants,
       promiseMakeServer,
       promiseGetConnections,
       promiseReadConnection,
       promiseAppendResponseText,
       Socket,
       promiseAll,
       Server,
       alistToDict,
       dictToAlist,
       lowercaseDict,
       caseInsensitiveAlistLack,
       HttpRequest,
       Webserver,
       UrlRouter,
       Form,
       YoDawg,
       init
      ].join("\n")
     };
    };
    this.router.routes["/index.html"] = function application(request){
     var scripts = [
      "https://ajax.googleapis.com/ajax/libs/jquery/3.2.1/jquery.min.js",
      indexjs
     ];
     var body = "<html><head><meta charset=\"utf-8\" />" +
      scripts.map(
       function(src){
        return "<script src=\"" + src + "\"></script>";
       }
      ).join("\n") + "<script>init()</script><body></body></html>";
     return {status: 200, headers: [["Content-Type", "text/html"]], body: body};
    };
    this.server.listenForever();
   },
   function init(){
    $(
     function(){
console.log("begin");
     }
    );
   }
  ].join("\n")
 );
};

staticRoutes["/index.html"] = function application(request, response){
 return respondHtml(
  response,
  htmlSimpleLines(
   "html",
   [
    htmlSimpleLines(
     "head",
     [
      htmlSingleton("meta", {charset: "utf-8"}),
      htmlSimpleLines("title", ["JS client for TCP over HTTP"]),
      htmlWrapMultiline(
       "script",
       {
        src: "https://ajax.googleapis.com/ajax/libs/jquery/3.2.1/jquery.min.js"
       },
       ""
      ),
      htmlWrapMultiline("script", {src: indexjs}, ""),
      htmlSimpleLines("script", ["init();"])
     ]
    ),
    htmlSimpleLines("body", [])
   ]
  )
 );
};


require("http").createServer(
 function(q, s){
  if(q.url in staticRoutes){
   return staticRoutes[q.url](q, s);
  }
  console.log(q);
  s.end("not found"); // TODO: 404
 }
).listen(
 +port,
 function(){
  console.log("http://localhost:" + +port + "/");
 }
);
