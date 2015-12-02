import XHR, {GetJSON} from "./async/xhr";
import {template, groupTemplate} from "./dom/template";
import {interpolateTextNode} from "./dom/manipulation";
import {log} from "./utils/debug";


log('hello from core.ts');

//xhr test
var bar = new GetJSON({ url: 'data.json' }).done(success).fail(fail).notify(notify);

function success(r) {
	log('success:');
	console.dir(r);
	interpolateTextNode(document.body, 'story', r.results[0]);
}
function fail(er) {}
function notify(ev) {}

//template test

var templTest = {
	tag: 'div',
	content: { 
		tag: 'ul',
		content: [
			{
				tag:'li',
				content: {
					tag: 'input', 
					attributes: {
						'type': 'text', 
						'value': 'any value you like'}
					}
			},
			{
				tag:'li',
				content: '<p>Average text for <b>average</b> websites</h3>'
			},
			{
				tag:'li',
				content: 'simple text'
			},
			{
				tag:'li',
				content: ['mucho', 'text', 'gracias']
			},
			{
				tag:'li',
				content: '<h2>Huge text for huge websites</h2>'
			}
		],
		attributes: { 'data-collapsible': 'very' } },
	attributes: { 'class': 'anything-you like' }
}

document.body.appendChild( template(templTest) )
document.body.appendChild( groupTemplate(templTest, templTest, templTest));