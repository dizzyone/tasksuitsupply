"use strict";

let gulp = require('gulp'),
	path = require('path'),
	config = require('../../project-config');
	
const CONTENT = config.paths.theme.content,
	DIST = config.paths.dist;

module.exports = {
	dependencies: [],
	aliases: ['copy'],
	task: function(){
		return gulp.src([
			path.join(CONTENT, '**/', '*.*'),
		])
		.pipe(
			gulp.dest(
				path.join(DIST, 'content')
			)
		)
	}
}