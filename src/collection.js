import Query from './query'
import {
  _,
  addHiddenPropsToTarget,
  classCallCheck,
  deepMixIn,
  eventify,
  extend,
  fillIn,
  forOwn,
  get,
  isArray,
  isFunction,
  isObject,
  isSorN,
  isString,
  set,
  uuid
} from './utils'
import {Index} from '../lib/mindex/index'

const COLLECTION_DEFAULTS = {
  /**
   * TODO
   *
   * @name Collection#autoPk
   * @type {boolean}
   * @default false
   */
  autoPk: false,

  /**
   * Field to be used as the unique identifier for records in this collection.
   * Defaults to `"id"` unless {@link Collection#mapper} is set, in which case
   * this will default to {@link Mapper#idAttribute}.
   *
   * @name Collection#idAttribute
   * @type {string}
   * @default "id"
   */
  idAttribute: 'id',

  /**
   * TODO
   *
   * @name Collection#mapper
   * @type {Mapper}
   * @default null
   */
  mapper: null,

  /**
   * What to do when inserting a record into this Collection that shares a
   * primary key with a record already in this Collection.
   *
   * Possible values:
   * - merge
   * - replace
   *
   * Merge:
   *
   * Recursively shallow copy properties from the new record onto the existing
   * record.
   *
   * Replace:
   *
   * Shallow copy top-level properties from the new record onto the existing
   * record. Any top-level own properties of the existing record that are _not_
   * on the new record will be removed.
   *
   * @name Collection#onConflict
   * @type {string}
   * @default "merge"
   */
  onConflict: 'merge',

  /**
   * TODO
   *
   * @name Collection#recordOpts
   * @type {Object}
   * @default {}
   */
  recordOpts: {}
}

/**
 * An ordered set of records.
 *
 * ```javascript
 * import {Collection, Record} from 'js-data'
 * const record1 = new Record({ id: 1 })
 * const record2 = new Record({ id: 2 })
 * const UserCollection = new Collection([record1, record2])
 * UserCollection.get(1) === record1 // true
 * ```
 *
 * @class Collection
 * @param {Array} [records] Initial set of records to insert into the
 * collection.
 * @param {Object} [opts] Configuration options.
 * @param {boolean} [opts.autoPk=false] TODO
 * @param {string} [opts.idAttribute] TODO
 * @param {string} [opts.onConflict=merge] TODO
 * @param {string} [opts.mapper] TODO
 * @param {Object} [opts.recordOpts={}] TODO
 */
export default function Collection (records, opts) {
  const self = this

  classCallCheck(self, Collection)

  if (isObject(records) && !isArray(records)) {
    opts = records
    records = []
  }

  // Default values for arguments
  records || (records = [])
  opts || (opts = {})

  fillIn(self, opts)

  /**
   * Event listeners attached to this Collection.
   *
   * @name Collection#_listeners
   * @instance
   * @type {Object}
   * @private
   */
  self._listeners = {}

  const idAttribute = self.recordId()

  /**
   * The main index, which uses @{link Collection#recordId} as the key.
   * @name Collection#index
   * @type {Index}
   */
  self.index = new Index([idAttribute], {
    hashCode (obj) {
      return get(obj, idAttribute)
    }
  })

  /**
   * Object that holds the secondary indexes of this collection.
   * @name Collection#indexes
   * @type {Object.<string, Index>}
   */
  self.indexes = {}

  /**
   * Object that holds the autoPks of records which needed ids to be generated.
   * @name Collection#autoPks
   * @type {Object.<number, Object>}
   */
  self.autoPks = {}

  records.forEach(function (record) {
    record = self.mapper ? self.mapper.createRecord(record) : record
    self.index.insertRecord(record)
    if (record && isFunction(record.on)) {
      record.on('all', self._onRecordEvent, self)
    }
  })
}

Collection.extend = extend

/**
 * TODO
 *
 * @name Collection#on
 * @instance
 * @method
 * @param {string} event TODO.
 * @param {Function} handler TODO
 */

 /**
 * TODO
 *
 * @name Collection#off
 * @instance
 * @method
 * @param {string} [event] TODO.
 * @param {Function} [handler] TODO
 */

 /**
 * TODO
 *
 * @name Collection#emit
 * @instance
 * @method
 * @param {string} event TODO.
 * @param {...*} [arg] TODO
 */

addHiddenPropsToTarget(Collection.prototype, {
  /**
   * Used to bind to events emitted by records in this Collection.
   *
   * @name Collection#_onRecordEvent
   * @method
   * @private
   * @param {...*} [arg] Args passed to {@link Collection#emit}.
   */
  _onRecordEvent (...args) {
    this.emit(...args)
  },

  /**
   * Insert the provided record or records.
   *
   * If a record is already in the collection then the provided record will
   * either merge with or replace the existing record based on the value of the
   * `onConflict` option.
   *
   * The collection's secondary indexes will be updated as each record is
   * visited.
   *
   * @name Collection#add
   * @method
   * @param {(Object|Object[]|Record|Record[])} data The record or records to insert.
   * @param {Object} [opts] - Configuration options.
   * @param {boolean} [opts.autoPk={@link Collection.autoPk}] - Whether to
   * generate primary keys for the records to be inserted. Useful for inserting
   * temporary, unsaved data into the collection.
   * @param {string} [opts.onConflict] - What to do when a record is already in
   * the collection. Possible values are `merge` or `replace`.
   * @return {(Object|Object[]|Record|Record[])} The added record or records.
   */
  add (records, opts) {
    const self = this

    // Default values for arguments
    opts || (opts = {})

    // Fill in "opts" with the Collection's configuration
    _(self, opts)
    records = self.beforeAdd(records, opts) || records

    // Track whether just one record or an array of records is being inserted
    let singular = false
    const idAttribute = self.recordId()
    if (!isArray(records)) {
      records = [records]
      singular = true
    }

    // Map the provided records to existing records.
    // New records will be inserted. If any records map to existing records,
    // they will be merged into the existing records according to the onConflict
    // option.
    records = records.map(function (record) {
      let id = self.recordId(record)
      // Track whether we had to generate an id for this record
      // Validate that the primary key attached to the record is a string or
      // number
      let autoPk = false
      if (!isSorN(id)) {
        // No id found, generate one
        if (opts.autoPk) {
          id = uuid()
          set(record, idAttribute, id)
          autoPk = true
        } else {
          // Not going to generate one, throw an error
          throw new TypeError(`${idAttribute}: Expected string or number, found ${typeof id}!`)
        }
      }
      // Grab existing record if there is one
      const existing = self.get(id)
      // If the currently visited record is just a reference to an existing
      // record, then there is nothing to be done. Exit early.
      if (record === existing) {
        return existing
      }

      if (existing) {
        // Here, the currently visited record corresponds to a record already
        // in the collection, so we need to merge them
        const onConflict = opts.onConflict || self.onConflict
        if (onConflict === 'merge') {
          deepMixIn(existing, record)
        } else if (onConflict === 'replace') {
          forOwn(existing, (value, key) => {
            if (key !== idAttribute && !record.hasOwnProperty(key)) {
              delete existing[key]
            }
          })
          existing.set(record)
        }
        record = existing
        // Update all indexes in the collection
        self.updateIndexes(record)
      } else {
        // Here, the currently visted record does not correspond to any record
        // in the collection, so (optionally) instantiate this record and insert
        // it into the collection
        record = self.mapper ? self.mapper.createRecord(record) : record
        self.index.insertRecord(record)
        forOwn(self.indexes, function (index, name) {
          index.insertRecord(record)
        })
        if (record && isFunction(record.on)) {
          record.on('all', self._onRecordEvent, self)
          // TODO: Make this more performant (batch events?)
          self.emit('add', record)
        }
      }
      if (autoPk) {
        self.autoPks[id] = record
      }
      return record
    })
    // Finally, return the inserted data
    const result = singular ? (records.length ? records[0] : undefined) : records
    return self.afterAdd(records, opts, result) || result
  },

  /**
   * Lifecycle hook called by {@link Collection#add}. If this method returns a
   * value then {@link Collection#add} will return that same value.
   *
   * @name Collection#method
   * @method
   * @param {(Object|Object[]|Record|Record[])} result The record or records
   * that were added to this Collection by {@link Collection#add}.
   * @param {Object} opts The `opts` argument passed to {@link Collection#add}.
   */
  afterAdd () {},

  /**
   * Lifecycle hook called by {@link Collection#remove}. If this method returns
   * a value then {@link Collection#remove} will return that same value.
   *
   * @name Collection#afterRemove
   * @method
   * @param {(string|number)} id The `id` argument passed to {@link Collection#remove}.
   * @param {Object} opts The `opts` argument passed to {@link Collection#remove}.
   * @param {Object} record The result that will be returned by {@link Collection#remove}.
   */
  afterRemove () {},

  /**
   * Lifecycle hook called by {@link Collection#removeAll}. If this method
   * returns a value then {@link Collection#removeAll} will return that same
   * value.
   *
   * @name Collection#afterRemoveAll
   * @method
   * @param {Object} query The `query` argument passed to {@link Collection#removeAll}.
   * @param {Object} opts The `opts` argument passed to {@link Collection#removeAll}.
   * @param {Object} records The result that will be returned by {@link Collection#removeAll}.
   */
  afterRemoveAll () {},

  /**
   * Lifecycle hook called by {@link Collection#add}. If this method returns a
   * value then the `records` argument in {@link Collection#add} will be
   * re-assigned to the returned value.
   *
   * @name Collection#beforeAdd
   * @method
   * @param {(Object|Object[]|Record|Record[])} records The `records` argument passed to {@link Collection#add}.
   * @param {Object} opts The `opts` argument passed to {@link Collection#add}.
   */
  beforeAdd () {},

  /**
   * Lifecycle hook called by {@link Collection#remove}.
   *
   * @name Collection#beforeRemove
   * @method
   * @param {(string|number)} id The `id` argument passed to {@link Collection#remove}.
   * @param {Object} opts The `opts` argument passed to {@link Collection#remove}.
   */
  beforeRemove () {},

  /**
   * Lifecycle hook called by {@link Collection#removeAll}.
   *
   * @name Collection#beforeRemoveAll
   * @method
   * @param {Object} query The `query` argument passed to {@link Collection#removeAll}.
   * @param {Object} opts The `opts` argument passed to {@link Collection#removeAll}.
   */
  beforeRemoveAll () {},

  /**
   * Find all records between two boundaries.
   *
   * Shortcut for `collection.query().between(18, 30, { index: 'age' }).run()`
   *
   * Get all users ages 18 to 30:
   * ```javascript
   * const users = collection.between(18, 30, { index: 'age' })
   * ```
   * Same as above:
   * ```javascript
   * const users = collection.between([18], [30], { index: 'age' })
   * ```
   *
   * @name Collection#between
   * @method
   * @param {Array} leftKeys Keys defining the left boundary.
   * @param {Array} rightKeys Keys defining the right boundary.
   * @param {Object} [opts] Configuration options.
   * @param {string} [opts.index] Name of the secondary index to use in the
   * query. If no index is specified, the main index is used.
   * @param {boolean} [opts.leftInclusive=true] Whether to include records
   * on the left boundary.
   * @param {boolean} [opts.rightInclusive=false] Whether to include records
   * on the left boundary.
   * @param {boolean} [opts.limit] Limit the result to a certain number.
   * @param {boolean} [opts.offset] The number of resulting records to skip.
   * @return {Array} The result.
   */
  between (leftKeys, rightKeys, opts) {
    return this.query().between(leftKeys, rightKeys, opts).run()
  },

  /**
   * Create a new secondary index on the contents of the collection.
   *
   * Index users by age:
   * ```javascript
   * collection.createIndex('age')
   * ```
   * Index users by status and role:
   * ```javascript
   * collection.createIndex('statusAndRole', ['status', 'role'])
   * ```
   *
   * @name Collection#createIndex
   * @method
   * @param {string} name - The name of the new secondary index.
   * @param {string[]} [fieldList] - Array of field names to use as the key or
   * compound key of the new secondary index. If no fieldList is provided, then
   * the name will also be the field that is used to index the collection.
   * @return {Collection} A reference to itself for chaining.
   */
  createIndex (name, fieldList, opts) {
    const self = this
    if (isString(name) && fieldList === undefined) {
      fieldList = [name]
    }
    opts || (opts = {})
    opts.hashCode = opts.hashCode || function (obj) {
      return self.recordId(obj)
    }
    const index = self.indexes[name] = new Index(fieldList, opts)
    self.index.visitAll(index.insertRecord, index)
    return self
  },

  /**
   * Find the record or records that match the provided query or pass the
   * provided filter function.
   *
   * Shortcut for `collection.query().filter(queryOrFn[, thisArg]).run()`
   *
   * Get the draft posts created less than three months:
   * ```javascript
   * const posts = collection.filter({
   *   where: {
   *     status: {
   *       '==': 'draft'
   *     },
   *     created_at_timestamp: {
   *       '>=': (new Date().getTime() - (1000 * 60 * 60 * 24 * 30 * 3)) // 3 months ago
   *     }
   *   }
   * })
   * ```
   * Use a custom filter function:
   * ```javascript
   * const posts = collection.filter(function (post) {
   *   return post.isReady()
   * })
   * ```
   *
   * @name Collection#filter
   * @method
   * @param {(Object|Function)} [queryOrFn={}] - Selection query or filter
   * function.
   * @param {Object} [thisArg] - Context to which to bind `queryOrFn` if
   * `queryOrFn` is a function.
   * @return {Array} The result.
   */
  filter (query, thisArg) {
    return this.query().filter(query, thisArg).run()
  },

  /**
   * Iterate over all records.
   *
   * ```javascript
   * collection.forEach(function (record) {
   *   // do something
   * })
   * ```
   *
   * @name Collection#forEach
   * @method
   * @param {Function} forEachFn - Iteration function.
   * @param {*} [thisArg] - Context to which to bind `forEachFn`.
   * @return {Array} The result.
   */
  forEach (cb, thisArg) {
    this.index.visitAll(cb, thisArg)
  },

  /**
   * Get the record with the given id.
   *
   * @name Collection#get
   * @method
   * @param {(string|number)} id - The primary key of the record to get.
   * @return {(Object|Record)} The record with the given id.
   */
  get (id) {
    const instances = this.query().get(id).run()
    return instances.length ? instances[0] : undefined
  },

  /**
   * Find the record or records that match the provided keyLists.
   *
   * Shortcut for `collection.query().getAll(keyList1, keyList2, ...).run()`
   *
   * Get the posts where "status" is "draft" or "inReview":
   * ```javascript
   * const posts = collection.getAll('draft', 'inReview', { index: 'status' })
   * ```
   * Same as above:
   * ```javascript
   * const posts = collection.getAll(['draft'], ['inReview'], { index: 'status' })
   * ```
   *
   * @name Collection#getAll
   * @method
   * @param {...Array} [keyList] - Provide one or more keyLists, and all
   * records matching each keyList will be retrieved. If no keyLists are
   * provided, all records will be returned.
   * @param {Object} [opts] - Configuration options.
   * @param {string} [opts.index] - Name of the secondary index to use in the
   * query. If no index is specified, the main index is used.
   * @return {Array} The result.
   */
  getAll (...args) {
    return this.query().getAll(...args).run()
  },

  /**
   * Return the records in this Collection that have a primary key that
   * was automatically generated when they were inserted.
   *
   * @name Collection#getAutoPkItems
   * @method
   * @return {(Object[]|Record[])} The records that have autoPks.
   */
  getAutoPkItems () {
    const self = this
    return self.getAll().filter(function (record) {
      return self.autoPks[self.recordId(record)]
    })
  },

  /**
   * Limit the result.
   *
   * Shortcut for `collection.query().limit(maximumNumber).run()`
   *
   * ```javascript
   * const posts = collection.limit(10)
   * ```
   *
   * @name Collection#limit
   * @method
   * @param {number} num - The maximum number of records to keep in the result.
   * @return {Array} The result.
   */
  limit (num) {
    return this.query().limit(num).run()
  },

  /**
   * Apply a mapping function to all records.
   *
   * ```javascript
   * const names = collection.map(function (user) {
   *   return user.name
   * })
   * ```
   *
   * @name Collection#map
   * @method
   * @param {Function} mapFn - Mapping function.
   * @param {*} [thisArg] - Context to which to bind `mapFn`.
   * @return {Array} The result of the mapping.
   */
  map (cb, thisArg) {
    const data = []
    this.index.visitAll(function (value) {
      data.push(cb.call(thisArg, value))
    })
    return data
  },

  /**
   * Return the result of calling the specified function on each record in this
   * collection's main index.
   *
   * @name Collection#mapCall
   * @method
   * @param {string} funcName - Name of function to call
   * @parama {...*} [args] - Remaining arguments to be passed to the function.
   * @return {Array} The result.
   */
  mapCall (funcName, ...args) {
    const data = []
    this.index.visitAll(function (record) {
      data.push(record[funcName](...args))
    })
    return data
  },

  /**
   * Return the primary key of the given, or if no record is provided, return the
   * name of the field that holds the primary key of records in this Collection.
   *
   * @name Collection#record
   * @method
   * @param {(Object|Record)} [record] The record whose primary key is to be
   * returned.
   * @return {(string|number)} Primary key or name of field that holds primary
   * key.
   */
  recordId (record) {
    if (record) {
      return get(record, this.recordId())
    }
    const self = this
    return self.mapper ? self.mapper.idAttribute : self.idAttribute || 'id'
  },

  /**
   * Create a new query to be executed against the contents of the collection.
   * The result will be all or a subset of the contents of the collection.
   *
   * Grab page 2 of users between ages 18 and 30:
   * ```javascript
   * collection.query()
   *   .between(18, 30, { index: 'age' }) // between ages 18 and 30
   *   .skip(10) // second page
   *   .limit(10) // page size
   *   .run()
   * ```
   *
   * @name Collection#query
   * @method
   * @return {Query} New query object.
   */
  query () {
    return new Query(this)
  },

  /**
   * Reduce the data in the collection to a single value and return the result.
   *
   * ```javascript
   * const totalVotes = collection.reduce(function (prev, record) {
   *   return prev + record.upVotes + record.downVotes
   * }, 0)
   * ```
   *
   * @name Collection#reduce
   * @method
   * @param {Function} cb - Reduction callback.
   * @param {*} initialValue - Initial value of the reduction.
   * @return {*} The result.
   */
  reduce (cb, initialValue) {
    const data = this.getAll()
    return data.reduce(cb, initialValue)
  },

  /**
   * Remove the record with the given id from this Collection.
   *
   * @name Collection#remove
   * @method
   * @param {(string|number)} id - The primary key of the record to be removed.
   * @param {Object} [opts] - Configuration options.
   * @return {Object|Record} The removed record, if any.
   */
  remove (id, opts) {
    const self = this

    // Default values for arguments
    opts || (opts = {})
    self.beforeRemove(id, opts)
    const record = self.get(id)

    // The record is in the collection, remove it
    if (record) {
      delete self.autoPks[id]
      self.index.removeRecord(record)
      forOwn(self.indexes, function (index, name) {
        index.removeRecord(record)
      })
      if (record && isFunction(record.off)) {
        record.off('all', self._onRecordEvent, self)
        self.emit('remove', record)
      }
    }
    return self.afterRemove(id, opts, record) || record
  },

  /**
   * Remove the record selected by "query" from this collection.
   *
   * @name Collection#removeAll
   * @method
   * @param {Object} [query={}] - Selection query.
   * @param {Object} [query.where] - Filtering criteria.
   * @param {number} [query.skip] - Number to skip.
   * @param {number} [query.limit] - Number to limit to.
   * @param {Array} [query.orderBy] - Sorting criteria.
   * @param {Object} [opts] - Configuration options.
   * @return {(Object[]|Record[])} The removed records, if any.
   */
  removeAll (query, opts) {
    const self = this
    // Default values for arguments
    opts || (opts = {})
    self.beforeRemoveAll(query, opts)
    const records = self.filter(query)

    // Remove each selected record from the collection
    records.forEach(function (item) {
      self.remove(self.recordId(item))
    })
    return self.afterRemoveAll(query, opts, records) || records
  },

  /**
   * Skip a number of results.
   *
   * Shortcut for `collection.query().skip(numberToSkip).run()`
   *
   * ```javascript
   * const posts = collection.skip(10)
   * ```
   *
   * @name Collection#skip
   * @method
   * @param {number} num - The number of records to skip.
   * @return {Array} The result.
   */
  skip (num) {
    return this.query().skip(num).run()
  },

  /**
   * Return the plain JSON representation of all items in this collection.
   * Assumes records in this collection have a toJSON method.
   *
   * @name Collection#toJSON
   * @method
   * @param {Object} [opts] - Configuration options.
   * @param {string[]} [opts.with] - Array of relation names or relation fields
   * to include in the representation.
   * @return {Array} The records.
   */
  toJSON (opts) {
    return this.mapCall('toJSON', opts)
  },

  /**
   * Update a record's position in a single index of this collection. See
   * {@link Collection#updateIndexes} to update a record's position in all
   * indexes at once.
   *
   * @name Collection#updateIndex
   * @method
   * @param {Object} record - The record to update.
   * @param {Object} [opts] - Configuration options.
   * @param {string} [opts.index] The index in which to update the record's
   * position. If you don't specify an index then the record will be updated
   * in the main index.
   */
  updateIndex (record, opts) {
    opts || (opts = {})
    const index = opts.index ? this.indexes[opts.index] : this.index
    index.updateRecord(record)
  },

  /**
   * TODO
   *
   * @name Collection#updateIndexes
   * @method
   * @param {Object} record - TODO
   * @param {Object} [opts] - Configuration options.
   */
  updateIndexes (record) {
    const self = this
    self.index.updateRecord(record)
    forOwn(self.indexes, function (index, name) {
      index.updateRecord(record)
    })
  }
})

eventify(
  Collection.prototype,
  function () {
    return this._listeners
  },
  function (value) {
    this._listeners = value
  }
)
