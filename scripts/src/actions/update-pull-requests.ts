import {GitHub} from '../github'

export async function updatePullRequests(context: any) {
  const github = await GitHub.getGitHub()

  const opts = github.client.pulls.list.endpoint.merge({
    ...context.repo,
    state: 'open'
  })
  const pulls = await github.client.paginate(opts)

  for (const pull of pulls) {
    if (pull.draft) {
      // skip draft pull requests
      continue
    }

    if (pull.user.type === 'Bot') {
      // skip bot pull requests
      continue
    }

    if (pull.base.ref !== context.ref) {
      // skip pull requests that are not on the target branch
      continue
    }

    if (pull.base.sha === context.sha) {
      // skip pull requests that are already up to date
      continue
    }

    github.client.pulls.updateBranch({
      ...pull.base.repo,
      pull_number: pull.number
    })
  }
}
