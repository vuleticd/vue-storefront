import * as types from '../mutation-types'
import { entityKeyName } from '../../lib/entities'
import { slugify } from '../../lib/filters'
const bodybuilder = require('bodybuilder')
import { quickSearchByQuery } from '../../api/search'

const state = {
  list: [],
  current: {},
  filters: { color: [], size: [], price: [] },
  breadcrumbs: {routes: []},
  current_path: [] // list of categories from root to current
}

const getters = {
}

// actions
const actions = {

  /**
   * Reset current category and path
   * @param {Object} context
   */
  reset (context) {
    context.commit(types.CATEGORY_UPD_CURRENT_CATEGORY_PATH, [])
    context.commit(types.CATEGORY_UPD_CURRENT_CATEGORY, {})
  },
  /**
   * Load categories within specified parent
   * @param {Object} commit promise
   * @param {Object} parent parent category
   */
  list (context, { parent = null, onlyActive = true, onlyNotEmpty = false, size = 150, start = 0 }) {
    const commit = context.commit
    let qrObj = bodybuilder()
    if (parent && typeof parent !== 'undefined') {
      qrObj = qrObj.filter('term', 'parent_id', parent.id)
    }

    if (onlyActive === true) {
      qrObj = qrObj.andFilter('term', 'is_active', true) // show only active cateogires
    }

    if (onlyNotEmpty === true) {
      qrObj = qrObj.andFilter('range', 'product_count', {'gt': 0}) // show only active cateogires
    }

    return quickSearchByQuery({ entityType: 'category', query: qrObj.build(), sort: 'position:asc' }).then(function (resp) {
      commit(types.CATEGORY_UPD_CATEGORIES, resp)
      return resp
    }).catch(function (err) {
      console.error(err)
    })
  },

  /**
   * Load category object by specific field - using local storage/indexed Db
   * loadCategories() should be called at first!
   * @param {Object} commit
   * @param {String} key
   * @param {String} value
   * @param {Bool} setCurrentCategory default=true and means that state.current_category is set to the one loaded
   */
  single (context, { key, value, setCurrentCategory = true, setCurrentCategoryPath = true }) {
    const state = context.state
    const commit = context.commit
    const dispatch = context.dispatch

    return new Promise((resolve, reject) => {
      let setcat = (error, mainCategory) => {
        if (error) {
          console.error(error)
          reject(error)
        }

        if (setCurrentCategory) {
          commit(types.CATEGORY_UPD_CURRENT_CATEGORY, mainCategory)
        }
        if (setCurrentCategoryPath) {
          let currentPath = []
          let recurCatFinder = (category) => {
            if (!category) {
              return
            }
            if (category.parent_id) {
              dispatch('single', { key: 'id', value: category.parent_id, setCurrentCategory: false, setCurrentCategoryPath: false }).then((sc) => { // TODO: move it to the server side for one requests OR cache in indexedDb
                if (!sc) {
                  commit(types.CATEGORY_UPD_CURRENT_CATEGORY_PATH, currentPath)
                  return resolve(mainCategory)
                }
                currentPath.unshift(sc)
                if (sc.parent_id) {
                  recurCatFinder(sc)
                }
              })
            } else {
              commit(types.CATEGORY_UPD_CURRENT_CATEGORY_PATH, currentPath)
              resolve(mainCategory)
            }
          }
          if (typeof mainCategory !== 'undefined' && mainCategory.parent_id) {
            recurCatFinder(mainCategory) // TODO: Store breadcrumbs in IndexedDb for further usage to optimize speed?
          }
        } else {
          resolve(mainCategory)
        }
      }

      if (state.list.length > 0) { // SSR - there were some issues with using localForage, so it's the reason to use local state instead, when possible
        let category = state.list.find((itm) => { return itm[key] === value })
        setcat(null, category)
      } else {
        const catCollection = global.db.categoriesCollection
        catCollection.getItem(entityKeyName(key, value), setcat)
      }
    })
  }
}

// mutations
const mutations = {

  [types.CATEGORY_UPD_CURRENT_CATEGORY] (state, category) {
    state.current = category
  },
  [types.CATEGORY_UPD_CURRENT_CATEGORY_PATH] (state, path) {
    state.current_path = path // TODO: store to cache
  },

  [types.CATEGORY_UPD_CATEGORIES] (state, categories) {
    state.list = categories.items

    for (let category of state.list) {
      for (let subcat of category.children_data) { // TODO: fixme and move slug setting to vue-storefront-api
        subcat = Object.assign(subcat, { slug: subcat.hasOwnProperty('name') ? slugify(subcat.name) + '-' + subcat.id : '' })
      }
      const catCollection = global.db.categoriesCollection
      try {
        catCollection.setItem(entityKeyName('slug', category.slug.toLowerCase()), category).catch((reason) => {
          console.debug(reason) // it doesn't work on SSR
        }) // populate cache by slug
        catCollection.setItem(entityKeyName('id', category.id), category).catch((reason) => {
          console.debug(reason) // it doesn't work on SSR
        }) // populate cache by id
      } catch (e) {
        console.error(e)
      }
    }
  }
}

export default {
  namespaced: true,
  state,
  getters,
  actions,
  mutations
}
