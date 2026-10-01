import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { encodeDavPath } from '../src/uploader'

describe('encodeDavPath', () => {
  it('encodes segments but keeps slashes', () => {
    assert.equal(encodeDavPath('/Videos/My Files/a b.txt'), '/Videos/My%20Files/a%20b.txt')
  })

  it('collapses duplicate and trailing slashes', () => {
    assert.equal(encodeDavPath('///Videos//'), '/Videos')
  })

  it('handles the root path', () => {
    assert.equal(encodeDavPath('/'), '/')
  })

  it('rejects traversal attempts', () => {
    assert.throws(() => encodeDavPath('/safe/../../etc'))
    assert.throws(() => encodeDavPath('/safe/../..'))
  })
})
