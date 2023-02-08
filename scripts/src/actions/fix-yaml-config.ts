import 'reflect-metadata'
import { addFileToAllRepos } from './shared/add-file-to-all-repos'
import {format} from './shared/format'
import {protectDefaultBranches} from './shared/protect-default-branches'

protectDefaultBranches()
addFileToAllRepos('.github/dependabot.yml')
format()
