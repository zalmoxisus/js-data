import utils from './utils'
import Component from './Component'
import Query from './Query'
import Index from '../lib/mindex/index'

const DOMAIN = 'Collection'

const COLLECTION_DEFAULTS = {
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
  onConflict: 'merge'
}

/**
 * An ordered set of {@link Record} instances.
 *
 * @example
 * import {Collection, Record} from 'js-data'
 * const user1 = new Record({ id: 1 })
 * const user2 = new Record({ id: 2 })
 * const UserCollection = new Collection([user1, user2])
 * UserCollection.get(1) === user1 // true
 *
 * @class Collection
 * @extends Component
 * @type {Function}
 * @param {Array} [records] Initial set of records to insert into the
 * collection.
 * @param {Object} [opts] Configuration options.
 * @param {string} [opts.idAttribute] See {@link Collection#idAttribute}.
 * @param {string} [opts.onConflict="merge"] See {@link Collection#onConflict}.
 * @param {string} [opts.mapper] See {@link Collection#mapper}.
 */
export default Component.extend({
  constructor: function Collection (records, opts) {
    const self = this
    utils.classCallCheck(self, Collection)
    Collection.__super__.call(self)

    if (records && !utils.isArray(records)) {
      opts = records
      records = []
    }
    if (utils.isString(opts)) {
      opts = { idAttribute: opts }
    }

    // Default values for arguments
    records || (records = [])
    opts || (opts = {})

    /**
     * Default Mapper for this collection. Optional. If a Mapper is provided, then
     * the collection will use the {@link Mapper#idAttribute} setting, and will
     * wrap records in {@link Mapper#recordClass}.
     *
     * @example
     * import {Collection, Mapper} from 'js-data'
     *
     * class MyMapperClass extends Mapper {
     *   foo () { return 'bar' }
     * }
     * const myMapper = new MyMapperClass()
     * const collection = new Collection(null, { mapper: myMapper })
     *
     * @name Collection#mapper
     * @type {Mapper}
     * @default null
     */
    Object.defineProperties(self, {
      mapper: {
        value: undefined,
        writable: true
      },
      queryClass: {
        value: undefined,
        writable: true
      }
    })

    // Apply user-provided configuration
    utils.fillIn(self, opts)
    // Fill in any missing options with the defaults
    utils.fillIn(self, utils.copy(COLLECTION_DEFAULTS))

    if (!self.queryClass) {
      self.queryClass = Query
    }

    const idAttribute = self.recordId()

    Object.defineProperties(self, {
      /**
       * The main index, which uses @{link Collection#recordId} as the key.
       *
       * @name Collection#index
       * @type {Index}
       */
      index: {
        value: new Index([idAttribute], {
          hashCode (obj) {
            return utils.get(obj, idAttribute)
          }
        })
      },

      /**
       * Object that holds the secondary indexes of this collection.
       *
       * @name Collection#indexes
       * @type {Object.<string, Index>}
       */
      indexes: {
        value: {}
      }
    })

    // Insert initial data into the collection
    if (records) {
      self.add(records)
    }
  },

  /**
   * Used to bind to events emitted by records in this Collection.
   *
   * @method Collection#_onRecordEvent
   * @since 3.0.0
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
   * @method Collection#add
   * @since 3.0.0
   * @param {(Object|Object[]|Record|Record[])} data The record or records to insert.
   * @param {Object} [opts] Configuration options.
   * @param {string} [opts.onConflict] What to do when a record is already in
   * the collection. Possible values are `merge` or `replace`.
   * @returns {(Object|Object[]|Record|Record[])} The added record or records.
   */
  add (records, opts) {
    const self = this

    // Default values for arguments
    opts || (opts = {})

    // Fill in "opts" with the Collection's configuration
    utils._(opts, self)
    records = self.beforeAdd(records, opts) || records

    // Track whether just one record or an array of records is being inserted
    let singular = false
    const idAttribute = self.recordId()
    if (!utils.isArray(records)) {
      if (utils.isObject(records)) {
        records = [records]
        singular = true
      } else {
        throw utils.err(`${DOMAIN}#add`, 'records')(400, 'object or array', records)
      }
    }

    // Map the provided records to existing records.
    // New records will be inserted. If any records map to existing records,
    // they will be merged into the existing records according to the onConflict
    // option.
    records = records.map(function (record) {
      let id = self.recordId(record)
      if (!utils.isSorN(id)) {
        throw utils.err(`${DOMAIN}#add`, `record.${idAttribute}`)(400, 'string or number', id)
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
          utils.deepMixIn(existing, record)
        } else if (onConflict === 'replace') {
          utils.forOwn(existing, (value, key) => {
            if (key !== idAttribute && !record.hasOwnProperty(key)) {
              delete existing[key]
            }
          })
          existing.set(record)
        } else {
          throw utils.err(`${DOMAIN}#add`, 'opts.onConflict')(400, 'one of (merge, replace)', onConflict, true)
        }
        record = existing
        // Update all indexes in the collection
        self.updateIndexes(record)
      } else {
        // Here, the currently visted record does not correspond to any record
        // in the collection, so (optionally) instantiate this record and insert
        // it into the collection
        record = self.mapper ? self.mapper.createRecord(record, opts) : record
        self.index.insertRecord(record)
        utils.forOwn(self.indexes, function (index, name) {
          index.insertRecord(record)
        })
        if (record && utils.isFunction(record.on)) {
          record.on('all', self._onRecordEvent, self)
        }
      }
      return record
    })
    // Finally, return the inserted data
    const result = singular ? records[0] : records
    // TODO: Make this more performant (batch events?)
    self.emit('add', result)
    return self.afterAdd(records, opts, result) || result
  },

  /**
   * Lifecycle hook called by {@link Collection#add}. If this method returns a
   * value then {@link Collection#add} will return that same value.
   *
   * @method Collection#method
   * @since 3.0.0
   * @param {(Object|Object[]|Record|Record[])} result The record or records
   * that were added to this Collection by {@link Collection#add}.
   * @param {Object} opts The `opts` argument passed to {@link Collection#add}.
   */
  afterAdd () {},

  /**
   * Lifecycle hook called by {@link Collection#remove}. If this method returns
   * a value then {@link Collection#remove} will return that same value.
   *
   * @method Collection#afterRemove
   * @since 3.0.0
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
   * @method Collection#afterRemoveAll
   * @since 3.0.0
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
   * @method Collection#beforeAdd
   * @since 3.0.0
   * @param {(Object|Object[]|Record|Record[])} records The `records` argument passed to {@link Collection#add}.
   * @param {Object} opts The `opts` argument passed to {@link Collection#add}.
   */
  beforeAdd () {},

  /**
   * Lifecycle hook called by {@link Collection#remove}.
   *
   * @method Collection#beforeRemove
   * @since 3.0.0
   * @param {(string|number)} id The `id` argument passed to {@link Collection#remove}.
   * @param {Object} opts The `opts` argument passed to {@link Collection#remove}.
   */
  beforeRemove () {},

  /**
   * Lifecycle hook called by {@link Collection#removeAll}.
   *
   * @method Collection#beforeRemoveAll
   * @since 3.0.0
   * @param {Object} query The `query` argument passed to {@link Collection#removeAll}.
   * @param {Object} opts The `opts` argument passed to {@link Collection#removeAll}.
   */
  beforeRemoveAll () {},

  /**
   * Find all records between two boundaries.
   *
   * Shortcut for `collection.query().between(18, 30, { index: 'age' }).run()`
   *
   * @example <caption>Get all users ages 18 to 30</caption>
   * const users = collection.between(18, 30, { index: 'age' })
   *
   * @example <caption>Same as above</caption>
   * const users = collection.between([18], [30], { index: 'age' })
   *
   * @method Collection#between
   * @since 3.0.0
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
   * @returns {Array} The result.
   */
  between (leftKeys, rightKeys, opts) {
    return this.query().between(leftKeys, rightKeys, opts).run()
  },

  /**
   * Create a new secondary index on the contents of the collection.
   *
   * @example <caption>Index users by age</caption>
   * collection.createIndex('age')
   *
   * @example <caption>Index users by status and role</caption>
   * collection.createIndex('statusAndRole', ['status', 'role'])
   *
   * @method Collection#createIndex
   * @since 3.0.0
   * @param {string} name - The name of the new secondary index.
   * @param {string[]} [fieldList] - Array of field names to use as the key or
   * compound key of the new secondary index. If no fieldList is provided, then
   * the name will also be the field that is used to index the collection.
   * @returns {Collection} A reference to itself for chaining.
   */
  createIndex (name, fieldList, opts) {
    const self = this
    if (utils.isString(name) && fieldList === undefined) {
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
   * @example <caption>Get the draft posts created less than three months</caption>
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
   *
   * @example <caption>Use a custom filter function</caption>
   * const posts = collection.filter(function (post) {
   *   return post.isReady()
   * })
   *
   * @method Collection#filter
   * @since 3.0.0
   * @param {(Object|Function)} [queryOrFn={}] - Selection query or filter
   * function.
   * @param {Object} [thisArg] - Context to which to bind `queryOrFn` if
   * `queryOrFn` is a function.
   * @returns {Array} The result.
   */
  filter (query, thisArg) {
    return this.query().filter(query, thisArg).run()
  },

  /**
   * Iterate over all records.
   *
   * @example
   * collection.forEach(function (record) {
   *   // do something
   * })
   *
   * @method Collection#forEach
   * @since 3.0.0
   * @param {Function} forEachFn - Iteration function.
   * @param {*} [thisArg] - Context to which to bind `forEachFn`.
   * @returns {Array} The result.
   */
  forEach (cb, thisArg) {
    this.index.visitAll(cb, thisArg)
  },

  /**
   * Get the record with the given id.
   *
   * @method Collection#get
   * @since 3.0.0
   * @param {(string|number)} id - The primary key of the record to get.
   * @returns {(Object|Record)} The record with the given id.
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
   * @example <caption>Get the posts where "status" is "draft" or "inReview"</caption>
   * const posts = collection.getAll('draft', 'inReview', { index: 'status' })
   *
   * @example <caption>Same as above</caption>
   * const posts = collection.getAll(['draft'], ['inReview'], { index: 'status' })
   *
   * @method Collection#getAll
   * @since 3.0.0
   * @param {...Array} [keyList] - Provide one or more keyLists, and all
   * records matching each keyList will be retrieved. If no keyLists are
   * provided, all records will be returned.
   * @param {Object} [opts] - Configuration options.
   * @param {string} [opts.index] - Name of the secondary index to use in the
   * query. If no index is specified, the main index is used.
   * @returns {Array} The result.
   */
  getAll (...args) {
    return this.query().getAll(...args).run()
  },

  /**
   * Return the index with the given name. If no name is provided, return the
   * main index. Throws an error if the specified index does not exist.
   *
   * @method Collection#getIndex
   * @since 3.0.0
   * @param {string} [name] The name of the index to retrieve.
   */
  getIndex (name) {
    const index = name ? this.indexes[name] : this.index
    if (!index) {
      throw utils.err(`${DOMAIN}#getIndex`, name)(404, 'index')
    }
    return index
  },

  /**
   * Limit the result.
   *
   * Shortcut for `collection.query().limit(maximumNumber).run()`
   *
   * @example
   * const posts = collection.limit(10)
   *
   * @method Collection#limit
   * @since 3.0.0
   * @param {number} num - The maximum number of records to keep in the result.
   * @returns {Array} The result.
   */
  limit (num) {
    return this.query().limit(num).run()
  },

  /**
   * Apply a mapping function to all records.
   *
   * @example
   * const names = collection.map(function (user) {
   *   return user.name
   * })
   *
   * @method Collection#map
   * @since 3.0.0
   * @param {Function} mapFn - Mapping function.
   * @param {*} [thisArg] - Context to which to bind `mapFn`.
   * @returns {Array} The result of the mapping.
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
   * @method Collection#mapCall
   * @since 3.0.0
   * @param {string} funcName - Name of function to call
   * @parama {...*} [args] - Remaining arguments to be passed to the function.
   * @returns {Array} The result.
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
   * @method Collection#recordId
   * @since 3.0.0
   * @param {(Object|Record)} [record] The record whose primary key is to be
   * returned.
   * @returns {(string|number)} Primary key or name of field that holds primary
   * key.
   */
  recordId (record) {
    const self = this
    if (record) {
      return utils.get(record, self.recordId())
    }
    return self.mapper ? self.mapper.idAttribute : self.idAttribute
  },

  /**
   * Create a new query to be executed against the contents of the collection.
   * The result will be all or a subset of the contents of the collection.
   *
   * @example <caption>Grab page 2 of users between ages 18 and 30</caption>
   * collection.query()
   *   .between(18, 30, { index: 'age' }) // between ages 18 and 30
   *   .skip(10) // second page
   *   .limit(10) // page size
   *   .run()
   *
   * @method Collection#query
   * @since 3.0.0
   * @returns {Query} New query object.
   */
  query () {
    const Ctor = this.queryClass
    return new Ctor(this)
  },

  /**
   * Reduce the data in the collection to a single value and return the result.
   *
   * @example
   * const totalVotes = collection.reduce(function (prev, record) {
   *   return prev + record.upVotes + record.downVotes
   * }, 0)
   *
   * @method Collection#reduce
   * @since 3.0.0
   * @param {Function} cb - Reduction callback.
   * @param {*} initialValue - Initial value of the reduction.
   * @returns {*} The result.
   */
  reduce (cb, initialValue) {
    const data = this.getAll()
    return data.reduce(cb, initialValue)
  },

  /**
   * Remove the record with the given id from this Collection.
   *
   * @method Collection#remove
   * @since 3.0.0
   * @param {(string|number)} id - The primary key of the record to be removed.
   * @param {Object} [opts] - Configuration options.
   * @returns {Object|Record} The removed record, if any.
   */
  remove (id, opts) {
    const self = this

    // Default values for arguments
    opts || (opts = {})
    self.beforeRemove(id, opts)
    const record = self.get(id)

    // The record is in the collection, remove it
    if (record) {
      self.index.removeRecord(record)
      utils.forOwn(self.indexes, function (index, name) {
        index.removeRecord(record)
      })
      if (record && utils.isFunction(record.off)) {
        record.off('all', self._onRecordEvent, self)
        self.emit('remove', record)
      }
    }
    return self.afterRemove(id, opts, record) || record
  },

  /**
   * Remove the record selected by "query" from this collection.
   *
   * @method Collection#removeAll
   * @since 3.0.0
   * @param {Object} [query={}] - Selection query.
   * @param {Object} [query.where] - Filtering criteria.
   * @param {number} [query.skip] - Number to skip.
   * @param {number} [query.limit] - Number to limit to.
   * @param {Array} [query.orderBy] - Sorting criteria.
   * @param {Object} [opts] - Configuration options.
   * @returns {(Object[]|Record[])} The removed records, if any.
   */
  removeAll (query, opts) {
    const self = this
    // Default values for arguments
    opts || (opts = {})
    self.beforeRemoveAll(query, opts)
    const records = self.filter(query)

    // Remove each selected record from the collection
    records.forEach(function (item) {
      self.remove(self.recordId(item), opts)
    })
    return self.afterRemoveAll(query, opts, records) || records
  },

  /**
   * Skip a number of results.
   *
   * Shortcut for `collection.query().skip(numberToSkip).run()`
   *
   * @example
   * const posts = collection.skip(10)
   *
   * @method Collection#skip
   * @since 3.0.0
   * @param {number} num - The number of records to skip.
   * @returns {Array} The result.
   */
  skip (num) {
    return this.query().skip(num).run()
  },

  /**
   * Return the plain JSON representation of all items in this collection.
   * Assumes records in this collection have a toJSON method.
   *
   * @method Collection#toJSON
   * @since 3.0.0
   * @param {Object} [opts] - Configuration options.
   * @param {string[]} [opts.with] - Array of relation names or relation fields
   * to include in the representation.
   * @returns {Array} The records.
   */
  toJSON (opts) {
    return this.mapCall('toJSON', opts)
  },

  /**
   * Update a record's position in a single index of this collection. See
   * {@link Collection#updateIndexes} to update a record's position in all
   * indexes at once.
   *
   * @method Collection#updateIndex
   * @since 3.0.0
   * @param {Object} record - The record to update.
   * @param {Object} [opts] - Configuration options.
   * @param {string} [opts.index] The index in which to update the record's
   * position. If you don't specify an index then the record will be updated
   * in the main index.
   */
  updateIndex (record, opts) {
    opts || (opts = {})
    this.getIndex(opts.index).updateRecord(record)
  },

  /**
   * TODO
   *
   * @method Collection#updateIndexes
   * @since 3.0.0
   * @param {Object} record - TODO
   * @param {Object} [opts] - Configuration options.
   */
  updateIndexes (record) {
    const self = this
    self.index.updateRecord(record)
    utils.forOwn(self.indexes, function (index, name) {
      index.updateRecord(record)
    })
  }
})