'use strict';
var menu = require('./menu.json');

var CommandProcessor = function (log) {
    var self = this;
    var logger = log;

    this.processCommand = function (command, cb) {
        var commArray = command.split(' ');
        var moreToProcess = true;
        var subMenu = menu;
        do {
            var menuElement = subMenu[commArray.shift()];
            if (!menuElement) {
                moreToProcess = false;
            } else {
                subMenu = menuElement;
                if (!menuElement.submenu) {
                    moreToProcess = false;
                } else {
                    subMenu = menuElement.submenu;
                }
            }
        } while (moreToProcess)
        cb(subMenu.command, commArray);
    }

    this.buildHelp = function () {
        return new Promise(function (resolve, reject) {
            var help = '';
            var baseCommand = '';
            JSON.stringify(menu, function (key, value) {
                if (key && key != 'command' && key != 'description' && key != 'submenu' && key != 'end') {
                    if (!value.submenu) {
                        help += `<b>${baseCommand + ' ' + key}</b>: ${value.description} </br>`;
                    } else {
                        baseCommand += key && ` ${key}`;
                    }
                } else if (key === 'end') {
                    baseCommand = '';
                }
                return value;
            });
            resolve(help);
        });
    }
}

module.exports = CommandProcessor;


