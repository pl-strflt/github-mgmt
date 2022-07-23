import 'reflect-metadata'
import * as terraform from '../terraform'
import * as yaml from '../yaml'
import {GitHub} from '../github'
import YAML from 'yaml'

// TODO: run this script as part of some workflow (PR?, sync?), for now run:
//       npm run build && TF_WORKSPACE=ipfs node lib/actions/protect-default-branches.js
async function run(): Promise<void> {
  const config = yaml.getConfig()
  const github = await GitHub.getGitHub()

  const repositories = await github.listRepositories()

  // TODO: we need a better abstraction for things that are defined in the YAML
  //       ideally, we should be able to replace all of this with something like:
  //       config.getRepositories().map(repository => repository.name)
  const names = config.getResources([terraform.GithubRepository]).map(repository => {
    return (repository.value as YAML.Pair).key as string
  })

  for (const name of names) {
    const repository = repositories.find(repository => repository.name === name)

    // TODO: we need a better abstraction here, one which has a proper constructor
    //       and doesn't know anything about terraform (i.e. values.id)
    const rule = new terraform.GithubBranchProtection()
    rule.values = {
      id: '',
      repository: name,
      pattern: repository!.default_branch as string,
      required_status_checks: {},
      required_pull_request_reviews: {},
    }

    // TODO: this is not pretty, maybe the context should be optional?
    const resource = await rule.getYAMLResource(null as any)

    // NOTE: add is a noop if a resource already exists
    config.add(resource)
  }

  config.save()
}

run()
