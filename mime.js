var mimeObject = require("./mime.json");
module.exports = {
	getType: function(ext){
		return mimeObject[ext] || null
	}
};