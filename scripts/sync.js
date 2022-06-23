import fs from 'fs';
import HCL from 'hcl2-parser';
import cli from '@actions/exec';
import YAML from 'yaml';
import merge from 'deepmerge';
import glob from '@actions/glob';
import crypto from 'crypto';

const __dirname = process.cwd();
const __rootdirname = fs.realpathSync(`${__dirname}/..`);

function hash(value) {
  return crypto.createHash('md5').update(value).digest("hex");
}

const Files = Object.fromEntries((await (await glob.create(`${__rootdirname}/files/**/*`, { matchDirectories: false })).glob()).map(path => {
  return [hash(fs.readFileSync(path)), path.substring(`${__rootdirname}/files/`.length)];
}));

const Terraform = {
  // This controls wether we take out a lock while accessing remote terraform resources
  // Using a lock is slower but more secure - defaults to using the locking mechanism
  LOCK: process.env.TF_LOCK != 'false',

  getWorkspace: async () => {
    let workspace = '';
    await cli.exec('terraform workspace show', null, {
      cwd: `${__rootdirname}/terraform`,
      listeners: { stdout: data => { workspace += data.toString(); } }
    })
    return workspace.trim();
  },
  getResourcesFromState: async () => {
    let content = '';
    await cli.exec('terraform show -json', null, {
      cwd: `${__rootdirname}/terraform`,
      listeners: { stdout: data => { content += data.toString(); } },
      silent: true
    });
    const state = JSON.parse(content);
    return state.values.root_module.resources.map(resource => {
      resource.id = resource.values.id;
      resource.type = resource.address.split('.')[0];
      return resource;
    }).reduce((resources, resource) => {
      resources[resource.type] = resources[resource.type] || [];
      resources[resource.type].push(resource);
      return resources;
    }, {});
  },
  getResourcesFromOutput: async () => {
    let content = '';
    await cli.exec('terraform output -json', null, {
      cwd: `${__rootdirname}/terraform`,
      listeners: { stdout: data => { content += data.toString(); } },
      silent: true
    });
    return Object.entries(JSON.parse(content)).flatMap(([type, resources]) => {
      return resources.value.map(resource => {
        return {
          type: type,
          id: (resource.id || resource).toString(),
          index: (resource.index || resource).toString()
        }
      });
    }).map(resource => {
      resource.address = `${resource.type}.this["${resource.index}"]`;
      return resource;
    }).reduce((resources, resource) => {
      resources[resource.type] = resources[resource.type] || [];
      resources[resource.type].push(resource);
      return resources;
    }, {});;
  },
  getFile: (name) => {
    const content = fs.readFileSync(`${__rootdirname}/terraform/${name}.tf`);
    const parsedContent = HCL.parseToObject(content)[0];
    if (fs.existsSync(`${__rootdirname}/terraform/${name}_override.tf`)) {
      const overrideContent = fs.readFileSync(`${__rootdirname}/terraform/${name}_override.tf`);
      const parsedOverrideContent = HCL.parseToObject(overrideContent)[0];
      return merge(parsedContent, parsedOverrideContent);
    } else {
      return parsedContent;
    }
  },
  refresh: async () => {
    await cli.exec(`terraform refresh -target=null_resource.resources -lock=${Terraform.LOCK}`, null, { cwd: `${__rootdirname}/terraform` });
    await cli.exec(`terraform apply -target=null_resource.data -auto-approve -lock=${Terraform.LOCK}`, null, { cwd: `${__rootdirname}/terraform` });
  },
  import: async (resource) => {
    await cli.exec(`terraform import -lock=${Terraform.LOCK} "${resource.address.replaceAll('"', '\\"')}" "${resource.id.replaceAll('"', '\\"')}"`, null, { cwd: `${__rootdirname}/terraform` });
  },
  delete: async (resource) => {
    await cli.exec(`terraform state rm -lock=${Terraform.LOCK} "${resource.address.replaceAll('"', '\\"')}"`, null, { cwd: `${__rootdirname}/terraform` });
  }
}

class YamlConfig {
  constructor(organization) {
    this.config = YAML.parseDocument(fs.readFileSync(`${__rootdirname}/github/${organization}.yml`, 'utf8'));
    this.updatePaths()
  }

  updatePaths() {
    const items = [this.config];
    while (items.length != 0) {
      const item = items.pop();
      if (item.contents?.items || item.value?.items) {
        (item.contents?.items || item.value?.items).forEach(child => {
          child.path = [...(item.path || []), child.key?.value || child.value]
          items.push(child);
        });
      }
    }
  }

  find(path) {
    return path.reduce((items, pathElement) => {
      return items
        .flatMap(item => {
          return item.value?.items || item;
        })
        .filter(item => {
          return (item.key?.value || item.value).match(new RegExp(`^${typeof pathElement == 'object' ? Object.keys(pathElement)[0] : pathElement}$`));
        });
    }, [{value: this.config.contents}]);
  }

  add(path) {
    for (const [index, pathElement] of Object.entries(path)) {
      const intIndex = parseInt(index);
      if (! this.has(path.slice(0, intIndex + 1))) {
        const parent = this.find(path.slice(0, intIndex))[0];
        if (intIndex + 1 == path.length) {
          if (YAML.isNode(pathElement) || YAML.isPair(pathElement)) {
            parent.value.items.push(pathElement);
          } else if (typeof pathElement == 'object') {
            parent.value.items.push(YAML.parseDocument(YAML.stringify(pathElement)).contents.items[0]);
          } else {
            parent.value.items.push(YAML.parseDocument(YAML.stringify(pathElement)).contents);
          }
        } else if (intIndex + 2 == path.length) {
          const nextPathElement = path[intIndex + 1];
          if (YAML.isPair(nextPathElement) || ((! YAML.isNode(nextPathElement)) && typeof nextPathElement == 'object')) {
            parent.value.items.push(YAML.parseDocument(YAML.stringify({ [pathElement]: {}})).contents.items[0]);
          } else {
            parent.value.items.push(YAML.parseDocument(YAML.stringify({ [pathElement]: []})).contents.items[0]);
          }
        } else {
          parent.value.items.push(YAML.parseDocument(YAML.stringify({ [pathElement]: {}})).contents.items[0]);
        }
      }
    }
  }

  delete(resource) {
    const parent = this.find(resource.path.slice(0, -1))[0];
    parent.value.items = parent.value.items.filter(child => {
      return child !== resource;
    });
  }

  move(resource, path) {
    this.add([...path.slice(0, -1), resource]);
    this.delete(resource);
  }

  toString() {
    //console.debug(JSON.stringify(this.config, null, 2));
    return this.config.toString({ collectionStyle: 'block' });
  }

  has(path) {
    return this.find(path).length != 0;
  }

  update(path) {
    const resource = this.find(path)[0].value;
    if (YAML.isMap(resource)) {
      Object.entries(Object.values(path[path.length-1])[0]).forEach(([key, value]) => {
        const item = resource.items.find(item => {
          return item.key.value == key;
        });
        if (item) {
          item.value = YAML.parseDocument(YAML.stringify(value)).contents;
        } else {
          resource.items.push(YAML.parseDocument(YAML.stringify({ [key]: value })).contents.items[0])
        }
      });
    }
  }

  ignore(path, keys) {
    const resource = this.find(path)[0].value;
    if (YAML.isMap(resource)) {
      resource.items = resource.items.filter(item => {
        return ! keys.includes(item.key.value);
      }).filter(item => {
        return ! (YAML.isScalar(item.value) && item.value.value == null);
      });
    }
  }
}

const ResourceHelpersByType = {
  github_membership: {
    getYamlConfigPathToAllTheResources: () => { return ['members', '(admin|member)', '.+']; },
    getYamlConfigPathToTheResource: (resourceFromTerraformState) => {
      return ['members', resourceFromTerraformState.values.role, resourceFromTerraformState.values.username];
    },
    getIgnoredProperties: () => {
      return [
        'etag',
        'id'
      ]
    },
    getIndex: (resourceFromYamlConfig) => {
      return resourceFromYamlConfig.value;
    }
  },
  github_repository: {
    getYamlConfigPathToAllTheResources: () => { return ['repositories', '.+']; },
    getYamlConfigPathToTheResource: (resourceFromTerraformState) => {
      const resource = {...resourceFromTerraformState.values};
      resource.pages = resource.pages[0] ? {
        cname: resource.pages[0].cname,
        source: resource.pages[0].source[0]
      } : null;
      resource.template = resource.template[0] || null;
      return ['repositories', { [resourceFromTerraformState.values.name]: resource }];
    },
    getIgnoredProperties: () => {
      return [
        'branches',
        'default_branch',
        'etag',
        'full_name',
        'git_clone_url',
        'html_url',
        'http_clone_url',
        'id',
        'node_id',
        'private',
        'repo_id',
        'ssh_clone_url',
        'svn_url',
        'name'
      ]
    },
    getIndex: (resourceFromYamlConfig) => {
      return resourceFromYamlConfig.key.value;
    }
  },
  github_repository_collaborator: {
    getYamlConfigPathToAllTheResources: () => { return ['repositories', '.+', 'collaborators', '(admin|maintain|push|triage|pull)', '.+']; },
    getYamlConfigPathToTheResource: (resourceFromTerraformState) => {
      return ['repositories', resourceFromTerraformState.values.repository, 'collaborators', resourceFromTerraformState.values.permission, resourceFromTerraformState.values.username];
    },
    getIgnoredProperties: () => {
      return [
        'id',
        'invitation_id',
        'permission_diff_suppression'
      ]
    },
    getIndex: (resourceFromYamlConfig) => {
      return `${resourceFromYamlConfig.path[1]}:${resourceFromYamlConfig.value}`;
    }
  },
  github_branch_protection: {
    getYamlConfigPathToAllTheResources: () => { return ['repositories', '.+', 'branch_protection', '.+']; },
    getYamlConfigPathToTheResource: (resourceFromTerraformState, terraformDataResources) => {
      const repositoryName = terraformDataResources.filter(resource => {
        return resource.address.startsWith("data.github_repository.this");
      }).find(resource => {
        return resource.values.node_id == resourceFromTerraformState.values.repository_id;
      }).values.name;
      const resource = {...resourceFromTerraformState.values};
      resource.required_pull_request_reviews = resource.required_pull_request_reviews[0] || null;
      resource.required_status_checks = resource.required_status_checks[0] || null;
      return ['repositories', repositoryName, 'branch_protection', { [resourceFromTerraformState.values.pattern]: resource }];
    },
    getIgnoredProperties: () => {
      return [
        'pattern',
        'repository_id',
        'id'
      ]
    },
    getIndex: (resourceFromYamlConfig) => {
      return `${resourceFromYamlConfig.path[1]}:${resourceFromYamlConfig.key.value}`;
    }
  },
  github_team: {
    getYamlConfigPathToAllTheResources: () => { return ['teams', '.+']; },
    getYamlConfigPathToTheResource: (resourceFromTerraformState) => {
      return ['teams', { [resourceFromTerraformState.values.name]: resourceFromTerraformState.values }];
    },
    getIgnoredProperties: () => {
      return [
        'etag',
        'id',
        'ldap_dn',
        'members_count',
        'node_id',
        'name',
        'slug'
      ]
    },
    getIndex: (resourceFromYamlConfig) => {
      return resourceFromYamlConfig.key.value;
    }
  },
  github_team_repository: {
    getYamlConfigPathToAllTheResources: () => { return ['repositories', '.+', 'teams', '(admin|maintain|push|triage|pull)', '.+']; },
    getYamlConfigPathToTheResource: (resourceFromTerraformState, terraformDataResources) => {
      const teamName = terraformDataResources.find(resource => {
        return resource.address == "data.github_organization_teams.this";
      }).values.teams.find(team => {
        return team.id == resourceFromTerraformState.values.team_id;
      }).name;
      return ['repositories', resourceFromTerraformState.values.repository, 'teams', resourceFromTerraformState.values.permission, teamName];
    },
    getIgnoredProperties: () => {
      return [
        'etag',
        'id'
      ]
    },
    getIndex: (resourceFromYamlConfig) => {
      return `${resourceFromYamlConfig.value}:${resourceFromYamlConfig.path[1]}`;
    }
  },
  github_team_membership: {
    getYamlConfigPathToAllTheResources: () => { return ['teams', '.+', 'members', '(maintainer|member)', '.+']; },
    getYamlConfigPathToTheResource: (resourceFromTerraformState, terraformDataResources) => {
      const teamName = terraformDataResources.find(resource => {
        return resource.address == "data.github_organization_teams.this";
      }).values.teams.find(team => {
        return team.id == resourceFromTerraformState.values.team_id;
      }).name;
      return ['teams', teamName, 'members', resourceFromTerraformState.values.role, resourceFromTerraformState.values.username];
    },
    getIgnoredProperties: () => {
      return [
        'etag',
        'id'
      ]
    },
    getIndex: (resourceFromYamlConfig) => {
      return `${resourceFromYamlConfig.path[1]}:${resourceFromYamlConfig.value}`;
    }
  },
  github_repository_file: {
    getYamlConfigPathToAllTheResources: () => { return ['repositories', '.+', 'files', '.+']; },
    getYamlConfigPathToTheResource: (resourceFromTerraformState) => {
      const resource = {...resourceFromTerraformState.values}
      resource.content = Files[hash(resource.content)] || resource.content;
      return ['repositories', resourceFromTerraformState.values.repository, 'files', { [resourceFromTerraformState.values.file]: resource }];
    },
    getIgnoredProperties: () => {
      return [
        'commit_sha',
        'file',
        'id',
        'repository',
        'sha'
      ]
    },
    getIndex: (resourceFromYamlConfig) => {
      return `${resourceFromYamlConfig.path[1]}/${resourceFromYamlConfig.key.value}`;
    }
  }
}

async function main() {
  const organization = await Terraform.getWorkspace();
  // Loading organization config
  const yamlConfig = new YamlConfig(organization);

  //await Terraform.refresh();
  let resourcesTerraformKnowsAboutByType = await Terraform.getResourcesFromState();
  const resourcesGitHubKnowsAboutByType = await Terraform.getResourcesFromOutput();

  const allResourceTypes = Object.keys(ResourceHelpersByType);
  const mergeOptions = { arrayMerge: (_a, b) => { return b; } };
  const managedResourceTypes = merge(...Terraform.getFile('locals').locals, mergeOptions).resource_types;
  const ignoredPropertiesByResourceType = Object.fromEntries(
    Object.entries(Terraform.getFile('resources').resource).filter(([key, _value]) => {
      return key.startsWith('github');
    }).map(([key, value]) => {
        return [key, merge(...value.this.flatMap(v => { return v.lifecycle; }), mergeOptions).ignore_changes.map(property => {
          return property.slice(2, -1);
        })];
      }
    )
  );

  for (const resourceType of allResourceTypes) {
    // Sync TF State with GitHub

    const resourcesTerraformKnowsAbout = resourcesTerraformKnowsAboutByType[resourceType] || [];
    const resourcesGitHubKnowsAbout = resourcesGitHubKnowsAboutByType[resourceType] || [];

    for (const terraformResource of resourcesTerraformKnowsAbout) {
      if (! managedResourceTypes.includes(terraformResource.type)) {
        await Terraform.delete(terraformResource);
      } else {
        const notInGitHubAnymore = ! resourcesGitHubKnowsAbout.find(gitHubResource => {
          return terraformResource.index == gitHubResource.index;
        });
        if (notInGitHubAnymore) {
          await Terraform.delete(terraformResource)
        }
      }
    }

    if (managedResourceTypes.includes(resourceType)) {
      for (const gitHubResource of resourcesGitHubKnowsAbout) {
        const notInTerraformStateYet = ! resourcesTerraformKnowsAbout.find(terraformResource => {
          return terraformResource.index == gitHubResource.index;
        });
        if (notInTerraformStateYet) {
          await Terraform.import(gitHubResource);
        }
      }
    }
  }

  // Retrieving resources again because we manipulated the state in the loop above
  // We do not care about resources from GitHub anymore because terraform state is synced already
  resourcesTerraformKnowsAboutByType = await Terraform.getResourcesFromState();

  // Sync YAML config with TF state
  for (const resourceType of allResourceTypes) {
    const ResourceHelper = ResourceHelpersByType[resourceType];

    // Retrieve resources that YAML config knows about
    const resourcesYamlConfigKnowsAbout = yamlConfig.find(ResourceHelper.getYamlConfigPathToAllTheResources());

    if (! managedResourceTypes.includes(resourceType)) {
      for (const yamlConfigResource of resourcesYamlConfigKnowsAbout) {
        yamlConfig.delete(yamlConfigResource);
      }
    } else {
      const resourcesTerraformKnowsAbout = resourcesTerraformKnowsAboutByType[resourceType] || [];
      const ignoredProperties = ignoredPropertiesByResourceType[resourceType];

      for (const yamlConfigResource of resourcesYamlConfigKnowsAbout) {
        const terraformResource = resourcesTerraformKnowsAbout.find(terraformResource => {
          return terraformResource.index == ResourceHelper.getIndex(yamlConfigResource);
        });
        // Remove all the resources that exist in YAML config but do not exist in TF state anymore
        if (! terraformResource) {
          yamlConfig.delete(yamlConfigResource)
        } else {
          const yamlConfigPath = ResourceHelper.getYamlConfigPathToTheResource(terraformResource, resourcesTerraformKnowsAboutByType.data);
          // Move all the resources within the YAML config for which the path has changed
          if (! yamlConfig.has(yamlConfigPath)) {
            yamlConfig.move(yamlConfigResource, yamlConfigPath);
          }
        }
      }

      for (const terraformResource of resourcesTerraformKnowsAbout) {
        const yamlConfigPath = ResourceHelper.getYamlConfigPathToTheResource(terraformResource, resourcesTerraformKnowsAboutByType.data);

        // Add all the resources that exist in TF state but do not exist in YAML config yet
        // Update all the resources that already exist in YAML config
        if (! yamlConfig.has(yamlConfigPath)) {
          yamlConfig.add(yamlConfigPath);
        } else {
          yamlConfig.update(yamlConfigPath);
        }
        // Ignore keys as per resources_override
        yamlConfig.ignore(yamlConfigPath, merge(ResourceHelper.getIgnoredProperties(ignoredProperties), ignoredProperties));
      }
    }
  }

  fs.writeFileSync(`${__rootdirname}/github/${organization}.yml`, yamlConfig.toString());
}

main();
