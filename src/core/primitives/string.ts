export const capitalize:Function = (base:string):string => {
	return base.charAt(0).toUpperCase() + base.slice(1);
}

export const uppercase:Function = (base:string):string => {
	return base.toUpperCase();
}

export const prefixCamelCase:Function = (prefix:string, base:string):string => {
	return prefix + capitalize(base);
}