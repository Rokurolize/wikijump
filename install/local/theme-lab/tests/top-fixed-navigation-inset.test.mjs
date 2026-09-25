import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {topFixedNavigationInset} from '../ports/interactive-visual-fixture/top-fixed-navigation-inset.mjs';

function evaluateInset(controls, height = 844) {
  const body = {};
  const context = {
    document: {body, querySelectorAll: () => controls},
    innerHeight: height,
    getComputedStyle: element => element.style
  };
  return vm.runInNewContext(`(${topFixedNavigationInset.toString()})()`, context);
}

function element({position = 'static', top = 0, bottom = 0, width = 40, height = 40, parent = null, menu = false} = {}) {
  return {
    style: {position},
    parentElement: parent,
    matches: selector => menu && selector === '.open-menu, .open-menu a',
    getBoundingClientRect: () => ({top, bottom, width, height})
  };
}

test('accounts for a fixed mobile control below the top edge', () => {
  const control = element({position: 'fixed', top: 16, bottom: 56});
  assert.equal(evaluateInset([control]), 56);
});

test('finds fixed ancestors of positioned mobile controls and ignores unrelated flow content', () => {
  const fixedHeader = element({position: 'fixed', top: 12, bottom: 68});
  const absoluteMenu = element({position: 'absolute', top: 16, bottom: 56, parent: fixedHeader});
  const staticBar = element({position: 'static', top: 0, bottom: 120});
  assert.equal(evaluateInset([absoluteMenu, staticBar]), 68);
});

test('ignores fixed controls outside the top navigation band', () => {
  assert.equal(evaluateInset([element({position: 'fixed', top: 180, bottom: 220})]), 0);
});

test('accounts for a visible absolutely positioned hamburger after its header has scrolled', () => {
  assert.equal(evaluateInset([element({position: 'absolute', top: 16, bottom: 56, menu: true})]), 56);
});
