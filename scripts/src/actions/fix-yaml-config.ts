import 'reflect-metadata'
import {Repository} from '../resources/repository'
import {addFileToAllRepos} from './shared/add-file-to-all-repos'
import {format} from './shared/format'
import {protectDefaultBranches} from './shared/protect-default-branches'
import {setPropertyInAllRepos} from './shared/set-property-in-all-repos'

function isInitialised(repository: Repository) {
  return !['ipdx', 'github-action-releaser'].includes(repository.name)
}

function isPublic(repository: Repository) {
  return repository.visibility === 'public'
}

protectDefaultBranches()
addFileToAllRepos(
  '.github/dependabot.yml',
  '.github/dependabot.yml',
  isInitialised
)
setPropertyInAllRepos(
  'secret_scanning',
  true,
  r => isInitialised(r) && isPublic(r)
)
setPropertyInAllRepos(
  'secret_scanning_push_protection',
  true,
  r => isInitialised(r) && isPublic(r)
)
format()
