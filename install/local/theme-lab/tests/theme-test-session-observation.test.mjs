import test from 'node:test';
import assert from 'node:assert/strict';
import {themeSessionObservationIsValid} from '../src/theme-test-session-observation.mjs';
const guest={my_account_text:null,logout_link_present:false,sign_in_link_present:true};
const admin={my_account_text:'Administrator',logout_link_present:true,sign_in_link_present:false};
test('canonical profiles require their observed runtime role',()=>{
  assert.equal(themeSessionObservationIsValid('anonymous',guest),true);
  assert.equal(themeSessionObservationIsValid('authenticated',admin),true);
  assert.equal(themeSessionObservationIsValid('authenticated',guest),false);
  assert.equal(themeSessionObservationIsValid('anonymous',admin),false);
  assert.equal(themeSessionObservationIsValid('authenticated',{...admin,my_account_text:'Other actor'}),false);
  assert.equal(themeSessionObservationIsValid('authenticated',{...admin,logout_link_present:false}),false);
  assert.equal(themeSessionObservationIsValid('authenticated',undefined),false);
});
