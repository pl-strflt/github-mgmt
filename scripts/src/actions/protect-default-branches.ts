import 'reflect-metadata'
import * as terraform from '../terraform'
import * as yaml from '../yaml'
import YAML from 'yaml'

// TODO: run this script as part of some workflow (PR?, sync?), for now run:
//       npm run build && TF_WORKSPACE=ipfs node lib/actions/protect-default-branches.js
async function run(): Promise<void> {
  const config = yaml.getConfig()

  // TODO: we need a better abstraction for things that are defined in the YAML
  //       ideally, we should be able to replace all of this with something like:
  //       config.getRepositories()
  const repositories = config.getResources([terraform.GithubRepository])

  for (const repository of repositories) {
    // TODO: we need a better abstraction for things that are defined in the YAML
    //       ideally, we should be able to replace all of this with something like:
    //       const name = repository.getName()
    //       const pattern = repository.getPattern()
    const name = ((repository.value as YAML.Pair).key as YAML.Scalar<string>).value
    const pattern = (((repository.value as YAML.Pair).value as YAML.YAMLMap).items.find(pair => {
      return (pair.key as YAML.Scalar<string>).value === 'pattern'
    })?.value as YAML.Scalar<string>)?.value || 'main'

    // TODO: we need a better abstraction here, one which has a proper constructor
    //       and doesn't know anything about terraform (i.e. values.id)
    const rule = new terraform.GithubBranchProtection()
    rule.index = `${name}:${pattern}`
    rule.values = {
      id: '',
      repository: name,
      pattern: pattern,
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
