import test from "ava";
import * as sinon from "sinon";
import * as assert from "assert";
import * as mswNode from "msw/node";
import * as prismic from "@prismicio/client";
import * as prismicM from "@prismicio/mock";
import * as prismicH from "@prismicio/helpers";
import * as cookie from "es-cookie";
import * as gatsby from "gatsby";
import * as React from "react";
import * as tlr from "@testing-library/react";
// import browserEnv from 'browser-env'
import globalJsdom from "global-jsdom";
import fetch from "node-fetch";

import { clearAllCookies } from "./__testutils__/clearAllCookies";
import { createAPIQueryMockedRequest } from "./__testutils__/createAPIQueryMockedRequest";
import { createAPIRepositoryMockedRequest } from "./__testutils__/createAPIRepositoryMockedRequest";
import { createGatsbyContext } from "./__testutils__/createGatsbyContext";
import { createPageProps } from "./__testutils__/createPageProps";
import { createPluginOptions } from "./__testutils__/createPluginOptions";
import { createPreviewRef } from "./__testutils__/createPreviewRef";
import { createPreviewURL } from "./__testutils__/createPreviewURL";
import { navigateToPreviewResolverURL } from "./__testutils__/navigateToPreviewResolverURL";

import {
	PluginOptions,
	PrismicPreviewProvider,
	WithPrismicPreviewResolverConfig,
	WithPrismicPreviewResolverProps,
	withPrismicPreviewResolver,
	PrismicRepositoryConfigs,
} from "../src";
import { onClientEntry } from "../src/on-client-entry";

const server = mswNode.setupServer();
test.before(() => {
	// browserEnv(['window', 'document'])
	globalJsdom(undefined, {
		url: "https://example.com",
		pretendToBeVisual: true,
	});
	server.listen({ onUnhandledRequest: "error" });
	window.requestAnimationFrame = function (callback) {
		return setTimeout(callback, 0);
	};
	console.error = sinon.stub();
});
test.beforeEach(() => {
	clearAllCookies();
	window.history.replaceState(null, "", createPreviewURL());
});
test.afterEach(() => tlr.cleanup());
test.after(() => {
	server.close();
});

const createRepositoryConfigs = (
	pluginOptions: PluginOptions,
): PrismicRepositoryConfigs => [
	{
		repositoryName: pluginOptions.repositoryName,
		linkResolver: (doc): string => `/${doc.uid}`,
	},
];

const createConfig = (): WithPrismicPreviewResolverConfig => ({
	navigate: sinon.stub().returns(void 0),
});

const Page = (props: gatsby.PageProps & WithPrismicPreviewResolverProps) => (
	<div>
		<div data-testid="isPrismicPreview">{String(props.isPrismicPreview)}</div>
		<div data-testid="prismicPreviewPath">{props.prismicPreviewPath}</div>
	</div>
);

const createTree = (
	pageProps: gatsby.PageProps,
	repositoryConfigs: PrismicRepositoryConfigs,
	config?: WithPrismicPreviewResolverConfig,
) => {
	const WrappedPage = withPrismicPreviewResolver(Page, repositoryConfigs, {
		...config,
		fetch,
	});

	return (
		<PrismicPreviewProvider>
			<WrappedPage {...pageProps} />
		</PrismicPreviewProvider>
	);
};

test.serial("renders component if not a preview", async (t) => {
	const gatsbyContext = createGatsbyContext();
	const pluginOptions = createPluginOptions(t);
	const pageProps = createPageProps();
	const hookConfig = createRepositoryConfigs(pluginOptions);
	const config = createConfig();
	const tree = createTree(pageProps, hookConfig, config);

	// @ts-expect-error - Partial gatsbyContext provided
	await onClientEntry(gatsbyContext, pluginOptions);
	const result = tlr.render(tree);

	t.true(result.getByTestId("isPrismicPreview").textContent === "false");
	t.true((config.navigate as sinon.SinonStub).notCalled);
});

test.serial("not a preview if documentId is not in URL", async (t) => {
	const gatsbyContext = createGatsbyContext();
	const pluginOptions = createPluginOptions(t);
	const pageProps = createPageProps();
	const hookConfig = createRepositoryConfigs(pluginOptions);
	const config = createConfig();
	const tree = createTree(pageProps, hookConfig, config);
	const token = createPreviewRef(pluginOptions.repositoryName);

	navigateToPreviewResolverURL(token, null);
	cookie.set(prismic.cookie.preview, token);

	// @ts-expect-error - Partial gatsbyContext provided
	await onClientEntry(gatsbyContext, pluginOptions);
	const result = tlr.render(tree);

	t.true(result.getByTestId("isPrismicPreview").textContent === "false");
	t.true((config.navigate as sinon.SinonStub).notCalled);
});

test.serial("not a preview if no token is available", async (t) => {
	const gatsbyContext = createGatsbyContext();
	const pluginOptions = createPluginOptions(t);
	const pageProps = createPageProps();
	const hookConfig = createRepositoryConfigs(pluginOptions);
	const config = createConfig();
	const tree = createTree(pageProps, hookConfig, config);
	const token = createPreviewRef(pluginOptions.repositoryName);

	navigateToPreviewResolverURL(token);

	// @ts-expect-error - Partial gatsbyContext provided
	await onClientEntry(gatsbyContext, pluginOptions);
	const result = tlr.render(tree);

	t.true(result.getByTestId("isPrismicPreview").textContent === "false");
	t.true((config.navigate as sinon.SinonStub).notCalled);
});

test.serial("redirects to path on valid preview", async (t) => {
	const gatsbyContext = createGatsbyContext();
	const pluginOptions = createPluginOptions(t);
	const pageProps = createPageProps();
	const hookConfig = createRepositoryConfigs(pluginOptions);
	const config = createConfig();
	const tree = createTree(pageProps, hookConfig, config);
	const ref = createPreviewRef(pluginOptions.repositoryName);

	const document = prismicM.value.document();
	const queryResponse = prismicM.api.query({ documents: [document] });
	const repositoryResponse = prismicM.api.repository({ seed: t.title });

	navigateToPreviewResolverURL(ref, document.id);
	cookie.set(prismic.cookie.preview, ref);

	server.use(
		createAPIRepositoryMockedRequest({ pluginOptions, repositoryResponse }),
		createAPIQueryMockedRequest({
			pluginOptions,
			repositoryResponse,
			queryResponse,
			searchParams: {
				ref,
				q: `[${prismic.predicate.at("document.id", document.id)}]`,
			},
		}),
	);

	// @ts-expect-error - Partial gatsbyContext provided
	await onClientEntry(gatsbyContext, pluginOptions);
	tlr.render(tree);

	await tlr.waitFor(() =>
		assert.ok((config.navigate as sinon.SinonStub).called),
	);

	t.true(
		(config.navigate as sinon.SinonStub).calledWith(
			prismicH.asLink(
				prismicH.documentToLinkField(document),
				hookConfig[0].linkResolver,
			),
		),
	);
});

test.serial(
	"does not redirect on valid preview if autoRedirect is false",
	async (t) => {
		const gatsbyContext = createGatsbyContext();
		const pluginOptions = createPluginOptions(t);
		const pageProps = createPageProps();
		const hookConfig = createRepositoryConfigs(pluginOptions);
		const config = createConfig();
		config.autoRedirect = false;
		const tree = createTree(pageProps, hookConfig, config);
		const ref = createPreviewRef(pluginOptions.repositoryName);

		const document = prismicM.value.document();
		const queryResponse = prismicM.api.query({ documents: [document] });
		const repositoryResponse = prismicM.api.repository({ seed: t.title });

		navigateToPreviewResolverURL(ref, document.id);
		cookie.set(prismic.cookie.preview, ref);

		server.use(
			createAPIRepositoryMockedRequest({ pluginOptions, repositoryResponse }),
			createAPIQueryMockedRequest({
				pluginOptions,
				repositoryResponse,
				queryResponse,
				searchParams: {
					ref,
					q: `[${prismic.predicate.at("document.id", document.id)}]`,
				},
			}),
		);

		// @ts-expect-error - Partial gatsbyContext provided
		await onClientEntry(gatsbyContext, pluginOptions);
		const result = tlr.render(tree);

		await tlr.waitFor(() =>
			assert.ok(result.getByTestId("prismicPreviewPath").textContent),
		);

		t.true(
			result.getByTestId("prismicPreviewPath").textContent ===
				prismicH.asLink(
					prismicH.documentToLinkField(document),
					hookConfig[0].linkResolver,
				),
		);
		t.true((config.navigate as sinon.SinonStub).notCalled);
	},
);
