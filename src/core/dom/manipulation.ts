import {interpolate} from "./../primitives/string";

export const Δ = document.querySelectorAll.bind(document);

// export const interpolateHTML: Function = (data: any, type?: string, element?: HTMLElement, delimiterRegEx?: RegExp): HTMLElement => {
// 	let interpolateType = `[data-interpolate${(!type) ? '' : `=${type}`}]`,
// 		delimiter = delimiterRegEx || /\{\{([\s\S]+?)\}\}/m;

// 	[].forEach.call(element.querySelectorAll(interpolateType), (node) => {
// 		if (!node.childNodes.length) return;
		
// 		[].filter.call(node.childNodes, (child) => {
// 			return (child.nodeName === '#text' || child instanceof Text) && delimiter.test(child.textContent);
// 		}).forEach((textNode) => { 
// 			// we are containing all textnodes with interpolated values in a span,
// 			// it takes considerable less effort to replace textnodes this way
// 			let newNode = document.createElement('span');
// 			newNode.insertAdjacentHTML('beforeend', interpolate(textNode.textContent, data));
// 			textNode.parentNode.replaceChild(newNode, textNode);
// 		});
// 	});

// 	return element;
// }

export const traverseTextNode: Function = (element: HTMLElement, query: string): HTMLElement[] => {
	let nodes = [];

	[].forEach.call(element.querySelectorAll(query), (node) => {
		if (!node.childNodes.length) return;
		//don't do a deep traverse, it isn't needed for our purposes as of yet.
		nodes = nodes.concat([].filter.call(node.childNodes, (child) => {
			return (child.nodeName === '#text' || child instanceof Text);
		}));
	});
	return nodes;
}

export const assignDelimitedTextNode: Function = (element: HTMLElement, query: string, delimiter: RegExp, assign: any): HTMLElement => {
	traverseTextNode(element, query).filter((node) => {
		return delimiter.test(node.textContent);
	}).forEach((textNode) => {
		assign(textNode);
	});

	return element;
}

export const interpolateTextNode: Function = (element: HTMLElement, interpolateQuery: string, data: any) => {
	let query = `[data-interpolate${(!interpolateQuery) ? '' : `=${interpolateQuery}`}]`,
		delimiter = /\{\{([\s\S]+?)\}\}/m; // matches: {{  }}
		
	assignDelimitedTextNode(element, query, delimiter, (textNode) => {
		// we are containing all textnodes with interpolated values in a span,
		// it takes considerable less effort to replace textnodes this way
		let newNode = document.createElement('span');
		newNode.insertAdjacentHTML('beforeend', interpolate(textNode.textContent, data));
		textNode.parentNode.replaceChild(newNode, textNode);
	});

	return element;
}


// export const injectTextNode: Function = (): HTMLElement => {

// }