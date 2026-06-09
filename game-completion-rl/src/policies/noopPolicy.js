const { emptyAction } = require('../runtime/actions');

class NoopPolicy {
  async reset() {}

  async act() {
    return emptyAction();
  }

  async onEpisodeEnd() {}
}

module.exports = { NoopPolicy };
